import fs from 'fs/promises'
import axios from 'axios'
import * as ui8 from 'uint8arrays'
import AtpAgent from '@atproto/api'
import * as plcLib from '@did-plc/lib'
import { AppContext, envToCfg, envToSecrets, readEnv } from './src'
import SqlRepoStorage from './src/sql-repo-storage'
import { createDeferrable } from '@atproto/common'

type PdsInfo = {
  id: number
  did: string
  url: string
  agent: AtpAgent
}

const run = async () => {
  const env = readEnv()
  const cfg = envToCfg(env)
  const secrets = envToSecrets(env)
  const ctx = await AppContext.fromConfig(cfg, secrets)
  const adminToken = ui8.toString(
    ui8.fromString(`admin:${secrets.adminPassword}`, 'utf8'),
    'base64pad',
  )

  const allDids = await readDidFile('all-dids.txt')
  const succeeded = await readDidFile('succeeded.txt')
  const failed = await readDidFile('failed.txt')

  const todoDids = allDids.filter(
    (did) => succeeded.indexOf(did) < 0 && failed.indexOf(did) < 0,
  )

  const pdsRes = await ctx.db.db.selectFrom('pds').selectAll().execute()
  const pdsInfos = pdsRes.map((row) => ({
    id: row.id,
    did: row.did,
    url: `https://${row.host}`,
    agent: new AtpAgent({ service: `https://${row.host}` }),
  }))
  let pdsCounter = 0
  for (const did of todoDids) {
    const pdsInfo = pdsInfos[pdsCounter % pdsInfos.length]
    try {
      await migrateRepo(ctx, pdsInfo, did, adminToken)
    } catch (err) {
      console.error(`failed to migrate: ${did}`, err)
    }
    pdsCounter++
  }
}

const migrateRepo = async (
  ctx: AppContext,
  pds: PdsInfo,
  did: string,
  adminToken: string,
) => {
  // verify not migrated yet
  const checkAccount = await getUserAccount(ctx, did)
  if (checkAccount.pdsId !== null) {
    console.log(`account already migrated: ${did} -> ${checkAccount.pdsId}`)
    return
  }
  const signingKeyRes =
    await pds.agent.api.com.atproto.server.reserveSigningKey({ did })
  const signingKey = signingKeyRes.data.signingKey

  const importedRev = await doImport(ctx, pds, did)

  const defer = createDeferrable()
  ctx.db
    .transaction(async (dbTxn) => {
      const storage = new SqlRepoStorage(dbTxn, did)
      await storage.lockRepo()
      await defer.complete
    })
    .catch((err) => {
      console.error(`error in repo lock tx for did: ${did}`, err)
    })

  try {
    await doImport(ctx, pds, did, importedRev)

    const lastOp = await ctx.plcClient.getLastOp(did)
    if (!lastOp || lastOp.type === 'plc_tombstone') {
      throw new Error('could not find last plc op')
    }
    const plcOp = await plcLib.createUpdateOp(
      lastOp,
      ctx.plcRotationKey,
      (normalized) => ({
        ...normalized,
        verificationMethods: {
          atproto: signingKey,
        },
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: pds.url,
          },
        },
      }),
    )

    const accountRes = await getUserAccount(ctx, did)
    await axios.post(`${pds.url}/xrpc/com.atproto.temp.transferAccount`, {
      did,
      handle: accountRes.handle,
      plcOp,
    })

    await transferPreferences(ctx, pds, did)
    await transferTakedowns(ctx, pds, did, adminToken)

    await ctx.db.db
      .updateTable('user_account')
      .where('did', '=', did)
      .set({ pdsId: pds.id })
      .execute()
    await ctx.db.db
      .updateTable('repo_root')
      .where('did', '=', did)
      .set({ did: `migrated-${did}` })
      .execute()
  } finally {
    defer.resolve()
  }
}

const doImport = async (
  ctx: AppContext,
  pds: PdsInfo,
  did: string,
  since?: string,
) => {
  const storage = new SqlRepoStorage(ctx.db, did)
  const root = await storage.getRootDetailed()
  if (!root) {
    throw new Error(`repo not found: ${did}`)
  }
  if (since && root.rev === since) {
    return
  }
  const carStream = await storage.getCarStream(since)

  const importRes = await axios.post(
    `${pds.url}/xrpc/com.atproto.temp.importRepo`,
    carStream,
    {
      params: { did },
      headers: { 'content-type': 'application/vnd.ipld.car' },
      decompress: true,
      responseType: 'stream',
    },
  )

  for await (const log of importRes.data) {
    console.log(`import update for ${did}: `, log.toString())
  }
  return root.rev
}

const transferPreferences = async (
  ctx: AppContext,
  pds: PdsInfo,
  did: string,
) => {
  const accessToken = await ctx.services
    .auth(ctx.db)
    .createAccessToken({ did: did, pdsDid: pds.did })

  const prefs = await ctx.services.account(ctx.db).getPreferences(did)
  await pds.agent.api.app.bsky.actor.putPreferences(
    { preferences: prefs },
    {
      headers: { authorization: `Bearer ${accessToken}` },
      encoding: 'application/json',
    },
  )
}

const transferTakedowns = async (
  ctx: AppContext,
  pds: PdsInfo,
  did: string,
  adminToken: string,
) => {
  const [accountRes, takendownRecords, takendownBlobs] = await Promise.all([
    getUserAccount(ctx, did),
    ctx.db.db
      .selectFrom('record')
      .selectAll()
      .where('did', '=', did)
      .where('takedownRef', 'is not', null)
      .execute(),
    ctx.db.db
      .selectFrom('repo_blob')
      .selectAll()
      .where('did', '=', did)
      .where('takedownRef', 'is not', null)
      .execute(),
  ])
  if (accountRes.takedownRef) {
    await pds.agent.com.atproto.admin.updateSubjectStatus(
      {
        subject: {
          $type: 'com.atproto.admin.defs#repoRef',
          did,
        },
        takedown: {
          applied: true,
          ref: accountRes.takedownRef,
        },
      },
      {
        headers: { authorization: `Basic ${adminToken}` },
        encoding: 'application/json',
      },
    )
  }

  for (const takendownRecord of takendownRecords) {
    if (!takendownRecord.takedownRef) continue
    await pds.agent.com.atproto.admin.updateSubjectStatus(
      {
        subject: {
          $type: 'com.atproto.repo.strongRef',
          uri: takendownRecord.uri,
          cid: takendownRecord.cid,
        },
        takedown: {
          applied: true,
          ref: takendownRecord.takedownRef,
        },
      },
      {
        headers: { authorization: `Basic ${adminToken}` },
        encoding: 'application/json',
      },
    )
  }

  for (const takendownBlob of takendownBlobs) {
    if (!takendownBlob.takedownRef) continue
    await pds.agent.com.atproto.admin.updateSubjectStatus(
      {
        subject: {
          $type: 'com.atproto.admin.defs#repoBlobRef',
          did,
          cid: takendownBlob.cid,
          recordUri: takendownBlob.recordUri,
        },
        takedown: {
          applied: true,
          ref: takendownBlob.takedownRef,
        },
      },
      {
        headers: { authorization: `Basic ${adminToken}` },
        encoding: 'application/json',
      },
    )
  }
}

const getUserAccount = async (ctx: AppContext, did: string) => {
  const accountRes = await ctx.db.db
    .selectFrom('did_handle')
    .innerJoin('user_account', 'user_account.did', 'did_handle.did')
    .selectAll()
    .where('did', '=', did)
    .executeTakeFirst()
  if (!accountRes) {
    throw new Error(`could not find account: ${did}`)
  }
  return accountRes
}

const readDidFile = async (name: string): Promise<string[]> => {
  const contents = await fs.readFile(name)
  return contents
    .toString()
    .split('\n')
    .map((did) => did.trim())
}

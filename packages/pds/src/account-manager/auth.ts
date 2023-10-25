import * as jwt from 'jsonwebtoken'
import * as ui8 from 'uint8arrays'
import * as crypto from '@atproto/crypto'
import { AuthScope } from '../auth-verifier'
import { AccountDb } from './db'

export type AuthToken = {
  scope: AuthScope
  sub: string
  exp: number
}

export type RefreshToken = AuthToken & { jti: string }

export const createTokens = (opts: {
  did: string
  jwtSecret: string
  scope?: AuthScope
  jti?: string
  expiresIn?: string | number
}) => {
  const { did, jwtSecret, scope, jti, expiresIn } = opts
  const access = createAccessToken({ did, jwtSecret, scope, expiresIn })
  const refresh = createRefreshToken({ did, jwtSecret, jti, expiresIn })
  return { access, refresh }
}

export const createAccessToken = (opts: {
  did: string
  jwtSecret: string
  scope?: AuthScope
  expiresIn?: string | number
}) => {
  const {
    did,
    jwtSecret,
    scope = AuthScope.Access,
    expiresIn = '120mins',
  } = opts
  const payload = {
    scope,
    sub: did,
  }
  return {
    payload: payload as AuthToken, // exp set by sign()
    jwt: jwt.sign(payload, jwtSecret, {
      expiresIn: expiresIn,
      mutatePayload: true,
    }),
  }
}

export const createRefreshToken = (opts: {
  did: string
  jwtSecret: string
  jti?: string
  expiresIn?: string | number
}) => {
  const {
    did,
    jwtSecret,
    jti = getRefreshTokenId(),
    expiresIn = '90days',
  } = opts
  const payload = {
    scope: AuthScope.Refresh,
    sub: did,
    jti,
  }
  return {
    payload: payload as RefreshToken, // exp set by sign()
    jwt: jwt.sign(payload, jwtSecret, {
      expiresIn: expiresIn,
      mutatePayload: true,
    }),
  }
}

export const storeRefreshToken = async (
  db: AccountDb,
  payload: RefreshToken,
  appPasswordName: string | null,
) => {
  return db.db
    .insertInto('refresh_token')
    .values({
      id: payload.jti,
      did: payload.sub,
      appPasswordName,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    })
    .onConflict((oc) => oc.doNothing()) // E.g. when re-granting during a refresh grace period
    .executeTakeFirst()
}

export const revokeRefreshTokensByDid = async (db: AccountDb, did: string) => {
  const { numDeletedRows } = await db.db
    .deleteFrom('refresh_token')
    .where('did', '=', did)
    .executeTakeFirst()
  return numDeletedRows > 0
}

export const revokeAppPasswordRefreshToken = async (
  db: AccountDb,
  did: string,
  appPassName: string,
) => {
  const { numDeletedRows } = await db.db
    .deleteFrom('refresh_token')
    .where('did', '=', did)
    .where('appPasswordName', '=', appPassName)
    .executeTakeFirst()
  return numDeletedRows > 0
}

export const getRefreshTokenId = () => {
  return ui8.toString(crypto.randomBytes(32), 'base64')
}

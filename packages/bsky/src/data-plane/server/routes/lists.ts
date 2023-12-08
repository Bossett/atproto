import { ServiceImpl } from '@connectrpc/connect'
import { Service } from '../../gen/bsky_connect'
import { Database } from '../../../db'
import { countAll } from '../../../db/util'
import { keyBy } from '@atproto/common'
import { TimeCidKeyset, paginate } from '../../../db/pagination'

export default (db: Database): Partial<ServiceImpl<typeof Service>> => ({
  async getListMembers(req) {
    const { listUri, cursor, limit } = req
    const { ref } = db.db.dynamic
    let builder = db.db
      .selectFrom('list_item')
      .where('listUri', '=', listUri)
      .selectAll()

    const keyset = new TimeCidKeyset(
      ref('list_item.sortAt'),
      ref('list_item.cid'),
    )

    builder = paginate(builder, {
      limit,
      cursor,
      keyset,
      tryIndex: true,
    })

    const listItems = await builder.execute()
    return {
      listitemUris: listItems.map((item) => item.uri),
      cursor: keyset.packFromResult(listItems),
    }
  },

  async getListMembership(req) {
    const { actorDid, listUris } = req
    if (listUris.length === 0) {
      return { listitemUris: [] }
    }
    const res = await db.db
      .selectFrom('list_item')
      .where('subjectDid', '=', actorDid)
      .where('listUri', 'in', listUris)
      .selectAll()
      .execute()
    const byListUri = keyBy(res, 'listUri')
    const listitemUris = listUris.map((uri) => byListUri[uri]?.uri ?? '')
    return {
      listitemUris,
    }
  },

  async getListCount(req) {
    const res = await db.db
      .selectFrom('list_item')
      .select(countAll.as('count'))
      .where('list_item.listUri', '=', req.listUri)
      .executeTakeFirst()
    return {
      count: res?.count,
    }
  },
})

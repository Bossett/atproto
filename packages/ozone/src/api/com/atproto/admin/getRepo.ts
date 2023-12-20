import { InvalidRequestError } from '@atproto/xrpc-server'
import { Server } from '../../../../lexicon'
import AppContext from '../../../../context'
import { addAccountInfoToRepoViewDetail, getPdsAccountInfo } from './util'

export default function (server: Server, ctx: AppContext) {
  server.com.atproto.admin.getRepo({
    auth: ctx.roleVerifier,
    handler: async ({ params, auth }) => {
      const { did } = params
      const db = ctx.db
      const [partialRepo, accountInfo] = await Promise.all([
        ctx.services.moderation(db).views.repoDetail(did),
        getPdsAccountInfo(ctx, did),
      ])
      if (!partialRepo) {
        throw new InvalidRequestError('Repo not found', 'RepoNotFound')
      }

      const repo = addAccountInfoToRepoViewDetail(
        partialRepo,
        accountInfo,
        auth.credentials.moderator,
      )
      return {
        encoding: 'application/json',
        body: repo,
      }
    },
  })
}
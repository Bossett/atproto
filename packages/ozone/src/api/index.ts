import { Server } from '../lexicon'
import AppContext from '../context'
import createReport from './moderation/createReport'
import emitModerationEvent from './admin/emitModerationEvent'
import searchRepos from './admin/searchRepos'
import adminGetRecord from './admin/getRecord'
import getRepo from './admin/getRepo'
import queryModerationStatuses from './admin/queryModerationStatuses'
import queryModerationEvents from './admin/queryModerationEvents'
import getModerationEvent from './admin/getModerationEvent'
import queryLabels from './label/queryLabels'
import subscribeLabels from './label/subscribeLabels'
import fetchLabels from './temp/fetchLabels'
import createCommunicationTemplate from './communication/createTemplate'
import updateCommunicationTemplate from './communication/updateTemplate'
import deleteCommunicationTemplate from './communication/deleteTemplate'
import listCommunicationTemplates from './communication/listTemplates'

export * as health from './health'

export * as wellKnown from './well-known'

export default function (server: Server, ctx: AppContext) {
  createReport(server, ctx)
  emitModerationEvent(server, ctx)
  searchRepos(server, ctx)
  adminGetRecord(server, ctx)
  getRepo(server, ctx)
  getModerationEvent(server, ctx)
  queryModerationEvents(server, ctx)
  queryModerationStatuses(server, ctx)
  queryLabels(server, ctx)
  subscribeLabels(server, ctx)
  fetchLabels(server, ctx)
  listCommunicationTemplates(server, ctx)
  createCommunicationTemplate(server, ctx)
  updateCommunicationTemplate(server, ctx)
  deleteCommunicationTemplate(server, ctx)
  return server
}

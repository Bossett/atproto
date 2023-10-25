import { Database, Migrator } from '../../db'
import { DatabaseSchema } from './schema'
import migrations from './migrations'

export * from './schema'

export type AccountDb = Database<DatabaseSchema>

export const getMigrator = (db: AccountDb) => {
  return new Migrator(db.db, migrations)
}

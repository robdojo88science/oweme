import Dexie, { type Table } from 'dexie'
import type { AuditLog, Borrower, Counters, Loan, Note, Settings, SignerProfile, Snapshot, Tombstone, Transaction } from '../core/model'
import { defaultScoring } from '../core/logic'

export function metadata(id: string = crypto.randomUUID()) { const at = new Date().toISOString(); return { id, createdAt: at, updatedAt: at } }
export const defaultSettings: Settings = {
  ...metadata('settings'), business: { name:'OweMe', address:'' }, defaults: {rate:.1,maxTerm:3,graceDays:5,interestMode:'upfront'},
  scoring: defaultScoring, backup:{}, haptics:true, receiptFooter:'Thank you. Keep this receipt for your records.',
  agreementText:'I acknowledge receiving the net release stated above and agree to repay the face amount according to the official schedule. Natanggap ko ang halagang nakasaad at nauunawaan ko ang kasunduan.',
  reminderTemplate:'Hi {name}, a friendly reminder that your payment of {amount} for {loan} is due on {date}. Salamat po!',
  adminEmail:'',defaultReceivedBy:'',borrowerPrefix:'',
}
class OweMeDB extends Dexie {
  borrowers!: Table<Borrower,string>; loans!:Table<Loan,string>; transactions!:Table<Transaction,string>;
  settings!:Table<Settings,string>; counters!:Table<Counters,string>; auditLogs!:Table<AuditLog,string>;
  tombstones!:Table<Tombstone,string>; signerProfiles!:Table<SignerProfile,string>; snapshots!:Table<Snapshot,string>; notes!:Table<Note,string>;
  constructor() {
    super('oweme')
    this.version(1).stores({
      borrowers:'id,&numericId,fullName,status,updatedAt', loans:'id,&loanNo,borrowerId,status,releaseDate,updatedAt',
      transactions:'id,&txnNo,loanId,borrowerId,type,date,voidOf,updatedAt',settings:'id',counters:'id',
      auditLogs:'id,at,entityId',tombstones:'id,entityId,deletedAt',signerProfiles:'id,name',snapshots:'id,createdAt',notes:'id,borrowerId,loanId,createdAt',
    })
  }
}
export const db = new OweMeDB()
export async function initDB() {
  await db.transaction('rw',[db.settings,db.counters],async()=>{
    if(!await db.settings.get('settings')) await db.settings.add(structuredClone(defaultSettings))
    if(!await db.counters.get('counters')) await db.counters.add({...metadata('counters'),borrower:0,txnByDay:{},loanByBorrower:{}})
  })
}
export async function saveSettings(settings: Settings) { await db.settings.put({...settings,id:'settings',updatedAt:new Date().toISOString()}) }

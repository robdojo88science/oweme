import type { Borrower, Installment, Loan, PaymentMethod, Settings, SignatureRef, Transaction } from '../core/model'
import { allocatePayment, assertCents, balance, borrowerNumber, canDeleteBorrower, formatMoney, quoteAdvance, quoteLoan, rollOverInstallments, schedule, today, transactionNumber } from '../core/logic'
import { db, initDB, metadata } from './db'

const mutationTables=()=>[db.borrowers,db.loans,db.transactions,db.settings,db.counters,db.auditLogs,db.tombstones,db.signerProfiles,db.notes]
async function settings() { const s=await db.settings.get('settings'); if(!s) throw new Error('Settings are unavailable. Reload the app.'); return s }
async function borrower(id:string) { const b=await db.borrowers.get(id); if(!b) throw new Error('Borrower account was not found.'); return b }
function snapshot(b:Borrower) { return {numericId:b.numericId,fullName:b.fullName} }
async function nextTxn(date:string) {
  const c=await db.counters.get('counters'); if(!c) throw new Error('Counters not initialized.')
  c.txnByDay[date]=(c.txnByDay[date]??0)+1
  await db.counters.put({...c,updatedAt:new Date().toISOString()})
  return transactionNumber(date,c.txnByDay[date])
}
async function nextLoan(b:Borrower) {
  const c=await db.counters.get('counters'); if(!c) throw new Error('Counters not initialized.')
  c.loanByBorrower[b.id]=(c.loanByBorrower[b.id]??0)+1
  await db.counters.put({...c,updatedAt:new Date().toISOString()})
  return `L-${borrowerNumber(b.numericId)}-${String(c.loanByBorrower[b.id]).padStart(2,'0')}`
}
async function audit(action:string,entity:string,entityId:string,detail:string) { await db.auditLogs.add({...metadata(),at:new Date().toISOString(),action,entity,entityId,detail}) }
async function rememberSigner(name:string) {
  const trimmed=name.trim(); if(!trimmed) return
  if(!await db.signerProfiles.where('name').equals(trimmed).first()) await db.signerProfiles.add({...metadata(),name:trimmed})
}
function terms(b:Borrower,s:Settings) {return {rate:b.rateOverride??s.defaults.rate,maxTerm:b.maxTermOverride??s.defaults.maxTerm,graceDays:b.graceDaysOverride??s.defaults.graceDays}}
export type BorrowerInput = Omit<Borrower,'id'|'createdAt'|'updatedAt'|'numericId'|'status'> & {status?:Borrower['status']}
function validateBorrower(input: Pick<Borrower,'fullName'|'address'|'monthlyIncome'> & Partial<Borrower>) {
  if(!input.fullName.trim()) throw new Error('Full name is required.')
  if(!input.address.trim()) throw new Error('Address is required.')
  assertCents(input.monthlyIncome,'Monthly income')
  if(input.rateOverride!==undefined && (!Number.isFinite(input.rateOverride)||input.rateOverride<0||input.rateOverride>=1)) throw new Error('Borrower interest must be from 0% to below 100%.')
  if(input.maxTermOverride!==undefined && (!Number.isInteger(input.maxTermOverride)||input.maxTermOverride<1||input.maxTermOverride>120)) throw new Error('Maximum term must be from 1 to 120 months.')
  if(input.graceDaysOverride!==undefined && (!Number.isInteger(input.graceDaysOverride)||input.graceDaysOverride<0||input.graceDaysOverride>365)) throw new Error('Mercy days must be from 0 to 365.')
}
export async function createBorrower(input:BorrowerInput):Promise<Borrower> {
  validateBorrower(input); await initDB()
  return db.transaction('rw',mutationTables(),async()=>{
    const c=await db.counters.get('counters'); if(!c) throw new Error('Counters not initialized.')
    c.borrower+=1; await db.counters.put({...c,updatedAt:new Date().toISOString()})
    const b:Borrower={...input,...metadata(),fullName:input.fullName.trim(),address:input.address.trim(),numericId:c.borrower,status:input.status??'active'}
    await db.borrowers.add(b); await audit('CREATE','borrower',b.id,`Created borrower #${borrowerNumber(b.numericId)}.`)
    return b
  })
}
export async function updateBorrower(id:string,patch:Partial<Borrower>):Promise<Borrower> {
  return db.transaction('rw',mutationTables(),async()=>{
    const existing=await borrower(id)
    const next={...existing,...patch,id:existing.id,numericId:existing.numericId,createdAt:existing.createdAt,updatedAt:new Date().toISOString()}
    validateBorrower(next); await db.borrowers.put(next); return next
  })
}
export interface CreateLoanInput {
  borrowerId:string; amount:number; term:number; releaseDate:string; releasedBy:string; income?:number; rate?:number;
  interestMode?:'upfront'|'added'; inputMode?:'face'|'cash'; overrideCap?:boolean; notes?:string; signatures?:Loan['signatures'];
}
export async function createLoan(input:CreateLoanInput):Promise<{loan:Loan;transaction:Transaction}> {
  await initDB()
  return db.transaction('rw',mutationTables(),async()=>{
    const b=await borrower(input.borrowerId),s=await settings(),t=terms(b,s)
    if(input.term>t.maxTerm) throw new Error(`Maximum term is ${t.maxTerm} months.`)
    if(!input.releasedBy.trim()) throw new Error('Released by name is required.')
    if(input.amount<=0) throw new Error('Loan amount must be greater than zero.')
    const rate=input.rate??t.rate,interestMode=input.interestMode??s.defaults.interestMode,income=input.income??b.monthlyIncome
    const q=quoteLoan({income,term:input.term,rate,interestMode,amount:input.amount,inputMode:input.inputMode})
    if(q.capExceeded&&!input.overrideCap) throw new Error('Face amount exceeds the income cap. Use Override cap to proceed.')
    const loan:Loan={...metadata(),loanNo:await nextLoan(b),borrowerId:b.id,borrowerSnapshot:snapshot(b),incomeAtLoan:income,
      termMonths:input.term,rate,interestMode,faceAmount:q.face,interestAmount:q.interest,netRelease:q.netRelease,monthlyAmount:q.monthly,
      releaseDate:input.releaseDate,status:'active',installments:schedule(q.face,input.term,input.releaseDate,t.graceDays),kind:'new',releasedBy:input.releasedBy.trim(),signatures:input.signatures??{},notes:input.notes}
    const transaction:Transaction={...metadata(),txnNo:await nextTxn(input.releaseDate),type:'RELEASE',loanId:loan.id,borrowerId:b.id,
      borrowerSnapshot:snapshot(b),amount:q.netRelease,receivedBy:input.releasedBy.trim(),balanceBefore:0,balanceAfter:q.face,allocation:[],date:input.releaseDate,notes:input.notes,nextDueDate:loan.installments[0]?.dueDate}
    await db.loans.add(loan); await db.transactions.add(transaction);await rememberSigner(input.releasedBy)
    if(input.overrideCap&&q.capExceeded) await audit('OVERRIDE_CAP','loan',loan.id,`Face ${q.face} exceeds cap ${q.maxFace}.`)
    return {loan,transaction}
  })
}
export interface CreateAdvanceInput extends Omit<CreateLoanInput,'inputMode'> {
  previousLoanId:string; mode:'merge'|'separate'; inputMode:'face'|'cash';
}
export async function createAdvance(input:CreateAdvanceInput):Promise<{loan:Loan;transaction:Transaction;previousLoan:Loan}> {
  await initDB()
  return db.transaction('rw',mutationTables(),async()=>{
    const b=await borrower(input.borrowerId),s=await settings(),t=terms(b,s)
    const previous=await db.loans.get(input.previousLoanId)
    if(!previous||previous.borrowerId!==b.id||previous.status!=='active'||balance(previous)<=0) throw new Error('Choose an active loan with an outstanding balance.')
    if(input.releaseDate<previous.releaseDate) throw new Error('Advance date cannot precede the original release.')
    const previousTxns=await db.transactions.where('loanId').equals(previous.id).toArray()
    if(previousTxns.some(x=>x.type==='PAYMENT'&&x.date>input.releaseDate)) throw new Error('Advance date must be on or after payments already recorded on this loan.')
    if(input.term>t.maxTerm) throw new Error(`Maximum term is ${t.maxTerm} months.`)
    if(!input.releasedBy.trim()) throw new Error('Released by name is required.')
    if(input.amount<=0) throw new Error('Advance amount must be greater than zero.')
    const allLoans=await db.loans.where('borrowerId').equals(b.id).toArray()
    const outstanding=allLoans.reduce((sum,l)=>sum+balance(l),0)
    const income=input.income??b.monthlyIncome,rate=input.rate??t.rate,interestMode=input.interestMode??s.defaults.interestMode
    const q=quoteAdvance({balance:balance(previous),allOutstanding:outstanding,income,term:input.term,rate,interestMode,amount:input.amount,inputMode:input.inputMode,mode:input.mode,releaseDate:input.releaseDate,graceDays:t.graceDays})
    if(q.capExceeded&&!input.overrideCap) throw new Error(q.maxAdvance<=0?'No advance available: the outstanding balance already reaches the income cap.':'Advance exceeds the combined exposure cap. Use Override cap to proceed.')
    const loanNo=await nextLoan(b)
    const autoNote=`Advance on ${input.releaseDate} · Balance carried ${formatMoney(q.carriedBalance)} (${previous.loanNo}) + advance ${formatMoney(q.advanceFace)} (interest ${formatMoney(q.interest)}, cash ${formatMoney(q.netCash)}) → ${input.mode==='merge'?'merged into':'separate loan'} ${loanNo} · ${formatMoney(q.newFace)} over ${input.term} months, ${formatMoney(q.monthly)}/month, first due ${q.installments[0].dueDate}.`
    const loan:Loan={...metadata(),loanNo,borrowerId:b.id,borrowerSnapshot:snapshot(b),incomeAtLoan:income,termMonths:input.term,rate,interestMode,
      faceAmount:q.newFace,interestAmount:q.interest,netRelease:q.netCash,monthlyAmount:q.monthly,releaseDate:input.releaseDate,status:'active',installments:q.installments,
      kind:'advance',parentLoanId:previous.id,carriedBalance:input.mode==='merge'?q.carriedBalance:0,advanceFace:q.advanceFace,autoNote,releasedBy:input.releasedBy.trim(),signatures:input.signatures??{},notes:input.notes}
    const transaction:Transaction={...metadata(),txnNo:await nextTxn(input.releaseDate),type:'ADVANCE',loanId:loan.id,borrowerId:b.id,borrowerSnapshot:snapshot(b),
      amount:q.netCash,receivedBy:input.releasedBy.trim(),balanceBefore:outstanding,balanceAfter:outstanding+q.advanceFace,allocation:[],date:input.releaseDate,notes:autoNote+(input.notes?`\n${input.notes}`:''),nextDueDate:loan.installments[0]?.dueDate,
      advance:{mode:input.mode,carriedBalance:q.carriedBalance,advanceFace:q.advanceFace,interest:q.interest,netCash:q.netCash,newFace:q.newFace,newTerm:input.term,newMonthly:q.monthly,previousLoanId:previous.id,newLoanId:loan.id,schedule:q.installments,previousInstallments:structuredClone(previous.installments)}}
    let previousLoan=previous
    if(input.mode==='merge') {
      previousLoan={...previous,status:'merged',mergedIntoLoanId:loan.id,installments:rollOverInstallments(previous.installments,input.releaseDate,s.scoring),updatedAt:new Date().toISOString()}
      await db.loans.put(previousLoan)
    }
    await db.loans.add(loan);await db.transactions.add(transaction);await db.notes.add({...metadata(),borrowerId:b.id,text:autoNote,kind:'advance',loanId:loan.id});await rememberSigner(input.releasedBy)
    if(input.overrideCap&&q.capExceeded) await audit('OVERRIDE_CAP','loan',loan.id,`Exposure ${(input.mode==='merge'?q.carriedBalance:outstanding)+q.advanceFace} exceeds cap ${q.maxFace}.`)
    return {loan,transaction,previousLoan}
  })
}
export interface ReceivePaymentInput {
  loanId:string; amount:number; date:string; method:PaymentMethod; receivedBy:string; bankName?:string; referenceNo?:string;
  proofImage?:Blob; signatures?:{payer?:SignatureRef;receiver?:SignatureRef}; notes?:string;
}
export async function receivePayment(input:ReceivePaymentInput):Promise<{loan:Loan;transaction:Transaction}> {
  await initDB()
  return db.transaction('rw',mutationTables(),async()=>{
    const original=await db.loans.get(input.loanId)
    if(!original||original.status!=='active') throw new Error('Choose an active loan.')
    if(input.date<original.releaseDate) throw new Error('Payment date cannot precede the loan release.')
    if(!input.receivedBy.trim()) throw new Error('Received by name is required.')
    const txns=await db.transactions.where('loanId').equals(original.id).toArray()
    const voids=new Set(txns.filter(x=>x.type==='VOID').map(x=>x.voidOf))
    if(txns.some(x=>x.type==='PAYMENT'&&!voids.has(x.id)&&x.date>input.date)) throw new Error('Record payments in date order. Void later payments before entering an earlier one.')
    const q=allocatePayment(original.installments,input.amount,input.date)
    const loan:Loan={...original,installments:q.installments,status:q.completed?'completed':'active',updatedAt:new Date().toISOString()}
    const transaction:Transaction={...input,...metadata(),txnNo:await nextTxn(input.date),type:'PAYMENT',borrowerId:original.borrowerId,
      borrowerSnapshot:original.borrowerSnapshot,balanceBefore:q.balanceBefore,balanceAfter:q.balanceAfter,allocation:q.allocation,unappliedAmount:q.unappliedAmount,nextDueDate:q.installments.find(x=>x.amountPaid<x.amountDue)?.dueDate}
    await db.loans.put(loan);await db.transactions.add(transaction);await rememberSigner(input.receivedBy)
    return {loan,transaction}
  })
}
function baseInstallments(loan:Loan):Installment[] {return loan.installments.map(x=>({no:x.no,dueDate:x.dueDate,graceUntil:x.graceUntil,amountDue:x.amountDue,amountPaid:0,status:'Upcoming'}))}
export async function voidTransaction(id:string,reason:string,date=today()):Promise<Transaction> {
  if(!reason.trim()) throw new Error('A reason is required to void a transaction.')
  return db.transaction('rw',mutationTables(),async()=>{
    const original=await db.transactions.get(id)
    if(!original||!['PAYMENT','ADVANCE'].includes(original.type)) throw new Error('Only payments and advances can be voided.')
    if(await db.transactions.where('voidOf').equals(id).first()) throw new Error('This transaction has already been voided.')
    const loan=await db.loans.get(original.loanId);if(!loan) throw new Error('Loan not found.')
    const loanTxns=await db.transactions.where('loanId').equals(loan.id).toArray()
    const voided=new Set((await db.transactions.where('type').equals('VOID').toArray()).map(x=>x.voidOf))
    const before=balance(loan)
    let after=before
    if(original.type==='ADVANCE'&&original.advance) {
      if(loanTxns.some(x=>x.type==='PAYMENT'&&!voided.has(x.id))) throw new Error('Void payments on this advance loan first.')
      if(loan.status==='merged') throw new Error('Void the later advance first.')
      const detail=original.advance
      if(detail.mode==='merge') {
        const previous=await db.loans.get(detail.previousLoanId)
        if(!previous||previous.mergedIntoLoanId!==loan.id||!detail.previousInstallments) throw new Error('The original loan cannot be restored safely.')
        await db.loans.put({...previous,status:'active',mergedIntoLoanId:undefined,installments:detail.previousInstallments,updatedAt:new Date().toISOString()})
        after=balance({installments:detail.previousInstallments})
      } else after=0
      await db.loans.put({...loan,status:'voided',updatedAt:new Date().toISOString()})
    } else {
      if(loan.status==='merged'||loan.status==='voided') throw new Error('Void the linked advance before changing its earlier payments.')
      let installments=baseInstallments(loan)
      const payments=loanTxns.filter(x=>x.type==='PAYMENT'&&x.id!==id&&!voided.has(x.id)).sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt.localeCompare(b.createdAt)||a.txnNo.localeCompare(b.txnNo))
      for(const p of payments) installments=allocatePayment(installments,p.amount,p.date).installments
      after=balance({installments})
      await db.loans.put({...loan,installments,status:after===0?'completed':'active',updatedAt:new Date().toISOString()})
    }
    const reversal:Transaction={...metadata(),txnNo:await nextTxn(date),type:'VOID',loanId:loan.id,borrowerId:original.borrowerId,borrowerSnapshot:original.borrowerSnapshot,
      amount:original.amount,receivedBy:original.receivedBy,balanceBefore:before,balanceAfter:after,allocation:[],voidOf:id,voidReason:reason.trim(),date,notes:`Voids ${original.txnNo}: ${reason.trim()}`}
    await db.transactions.add(reversal);await audit('VOID','transaction',original.id,reason.trim());return reversal
  })
}
export async function archiveBorrower(id:string) {return updateBorrower(id,{status:'archived'})}
export async function deleteBorrower(id:string,confirmation:string) {
  return db.transaction('rw',mutationTables(),async()=>{
    const b=await borrower(id)
    if(!canDeleteBorrower(b.fullName,confirmation)) throw new Error('Type the exact confirmation phrase, including capitalization.')
    await db.borrowers.delete(id)
    await db.notes.where('borrowerId').equals(id).delete()
    await db.tombstones.add({...metadata(),entity:'borrowers',entityId:id,deletedAt:new Date().toISOString()})
    await audit('DELETE_ACCOUNT','borrower',id,`Deleted account #${borrowerNumber(b.numericId)} ${b.fullName}. Loans and transactions retained.`)
  })
}
export async function addNote(borrowerId:string,text:string) {
  if(!text.trim()) throw new Error('Write a note first.')
  const note={...metadata(),borrowerId,text:text.trim(),kind:'manual' as const}
  await db.notes.add(note);return note
}
export async function attachLoanSignature(loanId:string,role:keyof Loan['signatures'],signature:SignatureRef|undefined) {
  const loan=await db.loans.get(loanId);if(!loan) throw new Error('Loan not found.')
  await db.loans.put({...loan,signatures:{...loan.signatures,[role]:signature},updatedAt:new Date().toISOString()})
}

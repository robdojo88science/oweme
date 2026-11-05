import { describe, expect, it } from 'vitest'
import { addDays, addMonthsClamped, allocatePayment, borrowerNumber, borrowerRating, canDeleteBorrower, formatMoney, installmentScore, installmentStatus, parseMoney, quoteAdvance, quoteLoan, rollOverInstallments, schedule, transactionNumber } from './logic'

describe('integer centavo loan calculations', () => {
  it('matches the required 1000 × 3 worked example', () => {
    const q = quoteLoan({ income: 100000, term: 3, rate: .1, interestMode: 'upfront' })
    expect(q).toMatchObject({ maxFace: 300000, face: 300000, interest: 30000, netRelease: 270000, monthly: 100000 })
  })
  it('parses decimals exactly and rejects fractional cents and malformed values', () => {
    expect(parseMoney('1,000.05')).toBe(100005)
    expect(parseMoney('0.29')).toBe(29)
    expect(() => parseMoney('1.001')).toThrow()
    expect(() => parseMoney('-1')).toThrow()
    expect(() => parseMoney('1e3')).toThrow()
    expect(formatMoney(100005)).toContain('1,000.05')
  })
  it('adds interest on top and reverses cash without floating point money', () => {
    expect(quoteLoan({ income: 100000, term: 3, rate: .1, interestMode: 'added', amount: 100000 })).toMatchObject({ face: 110000, interest: 10000, netRelease: 100000 })
    expect(quoteLoan({ income: 100000, term: 3, rate: .1, interestMode: 'upfront', amount: 45000, inputMode: 'cash' })).toMatchObject({ face: 50000, interest: 5000, netRelease: 45000 })
    expect(() => quoteLoan({ income: 100000, term: 3, rate: 1, interestMode: 'upfront', amount: 100, inputMode: 'cash' })).toThrow()
  })
  it('puts all remainder in final installment', () => {
    expect(schedule(250000, 3, '2026-12-05', 5).map(x => x.amountDue)).toEqual([83333, 83333, 83334])
    expect(() => schedule(100, 0, '2026-01-01', 5)).toThrow()
  })
})
describe('date-only calendar math', () => {
  it('clamps from original Jan 31, never cumulatively', () => {
    expect(schedule(300000, 3, '2026-01-31', 5).map(x => x.dueDate)).toEqual(['2026-02-28','2026-03-31','2026-04-30'])
  })
  it('clamps November 30 and leap days', () => {
    expect(schedule(300000, 3, '2026-11-30', 5).map(x => x.dueDate)).toEqual(['2026-12-30','2027-01-30','2027-02-28'])
    expect(addMonthsClamped('2024-01-31', 1)).toBe('2024-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(() => addDays('2026-02-30', 1)).toThrow()
  })
})
describe('oldest-first payments', () => {
  const s = () => schedule(300000, 3, '2026-01-05', 5)
  it('allocates 500 then 1500 and keeps receipt balances', () => {
    const first = allocatePayment(s(), 50000, '2026-02-05')
    expect(first).toMatchObject({ balanceBefore: 300000, balanceAfter: 250000, allocation: [{ installmentNo: 1, amount: 50000 }] })
    const second = allocatePayment(first.installments, 150000, '2026-02-06')
    expect(second.allocation).toEqual([{ installmentNo: 1, amount: 50000 }, { installmentNo: 2, amount: 100000 }])
    expect(second.balanceAfter).toBe(100000)
    expect(second.installments[0].paidDate).toBe('2026-02-06')
    expect(second.installments[1].paidDate).toBe('2026-02-06')
  })
  it('supports early exact and excess payments without losing overpayment', () => {
    const q = allocatePayment(s(), 310000, '2026-01-06')
    expect(q.balanceAfter).toBe(0)
    expect(q.unappliedAmount).toBe(10000)
    expect(q.installments.every(x => x.status === 'Paid')).toBe(true)
  })
})
describe('advance recalculation and frozen rollover scores', () => {
  const input = { balance: 200000, income: 100000, term: 3, rate: .1, interestMode: 'upfront' as const, mode: 'merge' as const, releaseDate: '2026-12-05', graceDays: 5 }
  it('matches advance worked example one', () => {
    const q = quoteAdvance({ ...input, amount: 100000, inputMode: 'face' })
    expect(q).toMatchObject({ maxAdvance: 100000, advanceFace: 100000, interest: 10000, netCash: 90000, newFace: 300000, monthly: 100000, capExceeded: false })
    expect(q.installments.map(x => x.dueDate)).toEqual(['2027-01-05','2027-02-05','2027-03-05'])
  })
  it('matches cash 450 example including 833.34 remainder', () => {
    const q = quoteAdvance({ ...input, amount: 45000, inputMode: 'cash' })
    expect(q).toMatchObject({ advanceFace: 50000, interest: 5000, netCash: 45000, newFace: 250000 })
    expect(q.installments.map(x => x.amountDue)).toEqual([83333,83333,83334])
  })
  it('uses all exposure for separate cap and charges interest only on advance', () => {
    const q = quoteAdvance({ ...input, amount: 90000, inputMode: 'cash', mode: 'separate', allOutstanding: 250000 })
    expect(q).toMatchObject({ newFace: 100000, interest: 10000, maxAdvance: 50000, capExceeded: true })
    expect(quoteAdvance({ ...input, amount: 100, inputMode: 'face', balance: 400000 }).maxAdvance).toBe(0)
    expect(quoteAdvance({...input,allOutstanding:250000,amount:100000,inputMode:'face'})).toMatchObject({maxAdvance:100000,capExceeded:false})
  })
  it('handles added-on-top advances and freezes overdue unpaid at zero', () => {
    expect(quoteAdvance({ ...input, interestMode: 'added', amount: 50000, inputMode: 'cash' })).toMatchObject({ advanceFace: 55000, interest: 5000, netCash: 50000, newFace: 255000 })
    const old = allocatePayment(schedule(300000,3,'2026-01-05',5),100000,'2026-02-05').installments
    const rolled = rollOverInstallments(old,'2026-03-20')
    expect(rolled[0].status).toBe('Paid')
    expect(rolled[1]).toMatchObject({ status:'rolled_over', frozenScore:0, frozenAt:'2026-03-20' })
    expect(installmentScore(rolled[1],'2027-01-01')).toBe(0)
    expect(installmentScore(rolled[2],'2027-01-01')).toBeNull()
  })
})
describe('statuses, ratings, and identifiers', () => {
  const item = schedule(100000,1,'2026-01-05',5)[0]
  it('handles every installment status boundary', () => {
    expect(installmentStatus(item,'2026-02-01')).toBe('Upcoming')
    expect(installmentStatus(item,'2026-02-02')).toBe('Due soon')
    expect(installmentStatus(item,'2026-02-05')).toBe('Due today')
    expect(installmentStatus(item,'2026-02-10')).toBe('Mercy')
    expect(installmentStatus(item,'2026-02-11')).toBe('Overdue')
    expect(installmentStatus({...item,amountPaid:100},'2026-02-01')).toBe('Partial')
    expect(installmentStatus({...item,amountPaid:100000},'2026-02-01')).toBe('Paid')
    expect(installmentStatus({...item,amountPaid:100},'2026-02-11')).toBe('Overdue')
  })
  it('scores on time, grace, late, minimum, unpaid and New correctly', () => {
    const paid = (d:string) => ({...item,amountPaid:item.amountDue,paidDate:d})
    expect(installmentScore(paid('2026-02-05'),'2026-03-01')).toBe(100)
    expect(installmentScore(paid('2026-02-10'),'2026-03-01')).toBe(85)
    expect(installmentScore(paid('2026-02-11'),'2026-03-01')).toBe(66)
    expect(installmentScore(paid('2026-03-11'),'2026-03-11')).toBe(10)
    expect(installmentScore(item,'2026-02-11')).toBe(0)
    expect(borrowerRating([], '2026-02-01')).toMatchObject({ stars:null, score:null, count:0 })
    expect(borrowerRating([{ installments:[paid('2026-02-05')], status:'active' }], '2026-03-01').stars).toBe(5)
  })
  it('grows IDs and sequences without truncation and validates exact deletion phrase', () => {
    expect(borrowerNumber(1)).toBe('001')
    expect(borrowerNumber(1000,'BR-')).toBe('BR-1000')
    expect(transactionNumber('2026-11-05',10000)).toBe('OM-20261105-10000')
    expect(canDeleteBorrower('Juan Dela Cruz','Delete Juan Dela Cruz')).toBe(true)
    expect(canDeleteBorrower('Juan Dela Cruz','delete Juan Dela Cruz')).toBe(false)
    expect(canDeleteBorrower('Juan Dela Cruz','Delete Juan Dela Cruz ')).toBe(false)
  })
  it('weights installments by official due-date recency and rounds half stars', () => {
    const earlier={...item,amountPaid:100000,paidDate:'2026-03-31'}
    const recent={...item,no:2,dueDate:'2026-03-05',graceUntil:'2026-03-10',amountPaid:100000,paidDate:'2026-03-05'}
    const result=borrowerRating([{status:'active',installments:[earlier,recent]}],'2026-04-01')
    expect(result.score).toBeCloseTo((100+10*.9)/1.9)
    expect(result.stars).toBe(3)
  })
})

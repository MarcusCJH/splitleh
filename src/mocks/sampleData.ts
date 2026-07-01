import type { SplitSession } from '../types'

/**
 * A realistic Singapore restaurant receipt for 4 people.
 * Use this during development to populate the app with real-looking data.
 *
 * Import and dispatch LOAD_DRAFT in any page to activate it:
 *   dispatch({ type: 'LOAD_DRAFT', payload: SAMPLE_SESSION })
 */
export const SAMPLE_SESSION: SplitSession = {
  id: 'mock-hawker-001',
  title: 'The Hawker Table — 4 pax',
  receipt: {
    merchant: 'The Hawker Table',
    date: '2025-07-01',
    currency: 'SGD',

    items: [
      {
        id: 'item-1',
        name: 'Hainanese Chicken Rice',
        unitPrice: 6.50,
        quantity: 2,
        totalPrice: 13.00,
        notes: 'Half chicken',
      },
      {
        id: 'item-2',
        name: 'Char Kway Teow',
        unitPrice: 9.00,
        quantity: 1,
        totalPrice: 9.00,
      },
      {
        id: 'item-3',
        name: 'Prawn Laksa',
        unitPrice: 10.50,
        quantity: 1,
        totalPrice: 10.50,
      },
      {
        id: 'item-4',
        name: 'Teh Tarik',
        unitPrice: 2.00,
        quantity: 4,
        totalPrice: 8.00,
        notes: 'Less sweet',
      },
      {
        id: 'item-5',
        name: 'Roti Prata (2 pcs)',
        unitPrice: 4.00,
        quantity: 1,
        totalPrice: 4.00,
      },
      {
        id: 'item-6',
        name: 'Milo Dinosaur',
        unitPrice: 3.50,
        quantity: 2,
        totalPrice: 7.00,
      },
    ],

    // Subtotal: 13.00 + 9.00 + 10.50 + 8.00 + 4.00 + 7.00 = 51.50
    // Service charge (10%): 5.15
    // GST (9% on 56.65): 5.10
    // Total: 51.50 + 5.15 + 5.10 = 61.75
    charges: [
      {
        id: 'svc',
        type: 'service_charge',
        label: 'Service Charge (10%)',
        amount: 5.15,
        rate: 0.1,
        splitStrategy: 'proportional',
      },
      {
        id: 'gst',
        type: 'gst',
        label: 'GST (9%)',
        amount: 5.10,
        rate: 0.09,
        splitStrategy: 'proportional',
      },
    ],

    subtotal: 51.50,
    total: 61.75,
  },

  people: [
    { id: 'p1', name: 'Alice', color: '#6C63FF' },
    { id: 'p2', name: 'Bob',   color: '#FF6584' },
    { id: 'p3', name: 'Carol', color: '#43C6AC' },
    { id: 'p4', name: 'Dave',  color: '#F7971E' },
  ],

  // Who ordered what
  // item-1 (Chicken Rice ×2)     → Alice + Bob share
  // item-2 (Char Kway Teow)      → Carol
  // item-3 (Prawn Laksa)         → Dave
  // item-4 (Teh Tarik ×4)        → everyone
  // item-5 (Roti Prata)          → Alice + Dave share
  // item-6 (Milo Dinosaur ×2)    → Bob + Carol share
  assignments: [
    { itemId: 'item-1', personIds: ['p1', 'p2'] },
    { itemId: 'item-2', personIds: ['p3'] },
    { itemId: 'item-3', personIds: ['p4'] },
    { itemId: 'item-4', personIds: ['p1', 'p2', 'p3', 'p4'] },
    { itemId: 'item-5', personIds: ['p1', 'p4'] },
    { itemId: 'item-6', personIds: ['p2', 'p3'] },
  ],

  splitMode: 'itemized',
  createdAt: 1751356800000,
  updatedAt: 1751356800000,
}

/**
 * A minimal 2-person session for quick testing of equal-split mode.
 */
export const SAMPLE_SESSION_EQUAL: SplitSession = {
  id: 'mock-coffee-001',
  title: 'Starbucks — 2 pax',
  receipt: {
    merchant: 'Starbucks',
    date: '2025-07-01',
    currency: 'SGD',
    items: [
      { id: 'c1', name: 'Caramel Macchiato (L)', unitPrice: 8.50, quantity: 1, totalPrice: 8.50 },
      { id: 'c2', name: 'Matcha Latte (M)',      unitPrice: 7.90, quantity: 1, totalPrice: 7.90 },
      { id: 'c3', name: 'Blueberry Muffin',      unitPrice: 4.50, quantity: 2, totalPrice: 9.00 },
    ],
    charges: [
      {
        id: 'gst',
        type: 'gst',
        label: 'GST (9%)',
        amount: 2.29,
        rate: 0.09,
        splitStrategy: 'proportional',
      },
    ],
    subtotal: 25.40,
    total: 27.69,
  },
  people: [
    { id: 'u1', name: 'Marcus', color: '#6C63FF' },
    { id: 'u2', name: 'Jamie',  color: '#FF6584' },
  ],
  assignments: [
    { itemId: 'c1', personIds: ['u1'] },
    { itemId: 'c2', personIds: ['u2'] },
    { itemId: 'c3', personIds: ['u1', 'u2'] },
  ],
  splitMode: 'equal',
  createdAt: 1751356800000,
  updatedAt: 1751356800000,
}

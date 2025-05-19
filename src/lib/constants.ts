
export const ROOM_AVAILABILITY_STATUS = {
  AVAILABLE: 0,
  OCCUPIED: 1,
  RESERVED: 2,
} as const;

export const ROOM_AVAILABILITY_STATUS_TEXT: { [key: number]: string } = {
  [ROOM_AVAILABILITY_STATUS.AVAILABLE]: 'Available',
  [ROOM_AVAILABILITY_STATUS.OCCUPIED]: 'Occupied',
  [ROOM_AVAILABILITY_STATUS.RESERVED]: 'Reserved',
};

export const TRANSACTION_STATUS = {
  UNPAID: '0', // Guest has checked in, payment pending at checkout
  PAID: '1',   // Transaction completed and paid
  ADVANCE_PAID: '2', // Reservation made, potentially with advance payment
  CANCELLED: '3', // Reservation or booking was cancelled
} as const;

export const TRANSACTION_STATUS_TEXT: { [key: string]: string } = {
  [TRANSACTION_STATUS.UNPAID]: 'Unpaid',
  [TRANSACTION_STATUS.PAID]: 'Paid',
  [TRANSACTION_STATUS.ADVANCE_PAID]: 'Advance Paid / Reserved',
  [TRANSACTION_STATUS.CANCELLED]: 'Cancelled',
};


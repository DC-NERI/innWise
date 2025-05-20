
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
  ADVANCE_PAID: '2', // Reservation made, potentially with advance payment (for immediate/soon assignment)
  CANCELLED: '3', // Reservation or booking was cancelled
  ADVANCE_RESERVATION: '4', // A future dated reservation with specific check-in/out times
} as const;

export const TRANSACTION_STATUS_TEXT: { [key: string]: string } = {
  [TRANSACTION_STATUS.UNPAID]: 'Unpaid / Occupied',
  [TRANSACTION_STATUS.PAID]: 'Paid',
  [TRANSACTION_STATUS.ADVANCE_PAID]: 'Advance Paid',
  [TRANSACTION_STATUS.CANCELLED]: 'Cancelled',
  [TRANSACTION_STATUS.ADVANCE_RESERVATION]: 'Advance Reservation',
};

export const NOTIFICATION_STATUS = {
  UNREAD: 0,
  READ: 1,
} as const;

export const NOTIFICATION_STATUS_TEXT: { [key: number]: string } = {
  [NOTIFICATION_STATUS.UNREAD]: 'Unread',
  [NOTIFICATION_STATUS.READ]: 'Read',
};

export const NOTIFICATION_TRANSACTION_STATUS = {
  PENDING_ACTION: 0,
  RESERVATION_CREATED: 1,
} as const;

export const NOTIFICATION_TRANSACTION_STATUS_TEXT: { [key: number]: string } = {
  [NOTIFICATION_TRANSACTION_STATUS.PENDING_ACTION]: 'Pending Action',
  [NOTIFICATION_TRANSACTION_STATUS.RESERVATION_CREATED]: 'Reservation Created',
};

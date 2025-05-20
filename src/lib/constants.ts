
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
  UNPAID: '0',
  PAID: '1',
  ADVANCE_PAID: '2',
  CANCELLED: '3',
  ADVANCE_RESERVATION: '4',
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
  PENDING_ACTION: 0, // Admin needs to act (e.g., create reservation)
  RESERVATION_CREATED: 1, // Admin has created a reservation linked to this notification
} as const;

export const NOTIFICATION_TRANSACTION_STATUS_TEXT: { [key: number]: string } = {
  [NOTIFICATION_TRANSACTION_STATUS.PENDING_ACTION]: 'Pending Action',
  [NOTIFICATION_TRANSACTION_STATUS.RESERVATION_CREATED]: 'Reservation Created',
};

export const TRANSACTION_IS_ACCEPTED_STATUS = {
    DEFAULT: 0,
    NOT_ACCEPTED: 1,
    ACCEPTED: 2,
    PENDING: 3,
} as const;

export const TRANSACTION_IS_ACCEPTED_STATUS_TEXT: { [key: number]: string} = {
    [TRANSACTION_IS_ACCEPTED_STATUS.DEFAULT]: 'Default',
    [TRANSACTION_IS_ACCEPTED_STATUS.NOT_ACCEPTED]: 'Not Accepted',
    [TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED]: 'Accepted by Branch',
    [TRANSACTION_IS_ACCEPTED_STATUS.PENDING]: 'Pending Branch Action',
};

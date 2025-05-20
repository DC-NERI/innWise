
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
  UNPAID: '0', // Client is checked-in, payment pending
  PAID: '1', // Transaction completed and paid
  ADVANCE_PAID: '2', // Reservation made with advance payment (room typically reserved) - Staff created for their branch
  CANCELLED: '3',
  ADVANCE_RESERVATION: '4', // Future reservation, no payment yet or different type - Staff created for their branch
  PENDING_BRANCH_ACCEPTANCE: '5', // Admin created, awaiting branch staff action
} as const;

export const TRANSACTION_STATUS_TEXT: { [key: string]: string } = {
  [TRANSACTION_STATUS.UNPAID]: 'Unpaid / Occupied',
  [TRANSACTION_STATUS.PAID]: 'Paid',
  [TRANSACTION_STATUS.ADVANCE_PAID]: 'Advance Paid / Reserved',
  [TRANSACTION_STATUS.CANCELLED]: 'Cancelled',
  [TRANSACTION_STATUS.ADVANCE_RESERVATION]: 'Advance Reservation',
  [TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE]: 'Pending Branch Acceptance',
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
    DEFAULT: 0, // Or 'Not Applicable' if it's not an admin-created one
    NOT_ACCEPTED: 1, // Branch rejected
    ACCEPTED: 2, // Branch accepted
    PENDING: 3, // Admin created, awaiting branch action
} as const;

export const TRANSACTION_IS_ACCEPTED_STATUS_TEXT: { [key: number]: string} = {
    [TRANSACTION_IS_ACCEPTED_STATUS.DEFAULT]: 'N/A', // Changed from Default to N/A for clarity
    [TRANSACTION_IS_ACCEPTED_STATUS.NOT_ACCEPTED]: 'Not Accepted by Branch',
    [TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED]: 'Accepted by Branch',
    [TRANSACTION_IS_ACCEPTED_STATUS.PENDING]: 'Pending Branch Action',
};

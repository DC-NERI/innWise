
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
} as const;

export const TRANSACTION_STATUS_TEXT: { [key: string]: string } = {
  [TRANSACTION_STATUS.UNPAID]: 'Unpaid',
  [TRANSACTION_STATUS.PAID]: 'Paid',
  [TRANSACTION_STATUS.ADVANCE_PAID]: 'Advance Paid',
};

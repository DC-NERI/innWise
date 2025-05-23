
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric

// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE


import { Pool } from 'pg';
import type { Transaction } from '@/lib/types';
import { transactionUpdateNotesSchema, TransactionUpdateNotesData } from '@/lib/schemas';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/transactions/updateTransactionNotes action', err);
});

export async function updateTransactionNotes(
  transactionId: number,
  notes: string | null | undefined,
  tenantId: number,
  branchId: number
): Promise<{ success: boolean; message?: string; updatedTransaction?: Pick<Transaction, 'id' | 'notes' | 'updated_at'> }> {
  const validatedFields = transactionUpdateNotesSchema.safeParse({ notes });
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }

  const { notes: validatedNotes } = validatedFields.data;
  const client = await pool.connect();

  try {
    const updateQuery = `
      UPDATE transactions
      SET notes = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $2 AND tenant_id = $3 AND branch_id = $4
      RETURNING id, notes, updated_at;
    `;

    const res = await client.query(updateQuery, [
      validatedNotes,
      transactionId,
      tenantId,
      branchId
    ]);

    if (res.rows.length > 0) {
      const updatedTransactionRow = res.rows[0];
      return {
        success: true,
        message: "Transaction notes updated successfully.",
        updatedTransaction: {
          id: Number(updatedTransactionRow.id),
          notes: updatedTransactionRow.notes,
          updated_at: String(updatedTransactionRow.updated_at),
        }
      };
    }
    return { success: false, message: "Transaction not found or update failed." };
  } catch (error) {
    const dbError = error as any;
    console.error('[updateTransactionNotes DB Error]', dbError);
    return { success: false, message: `Database error: ${dbError.message || String(dbError)}` };
  } finally {
    client.release();
  }
}

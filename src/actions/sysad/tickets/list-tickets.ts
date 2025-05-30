"use server";

import pg, { Pool } from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8/bigint
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2/smallint
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4/integer
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric/decimal

// Configure pg to return timestamp types as strings
pg.types.setTypeParser(1082, (stringValue) => stringValue); // DATE
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE (TIMESTAMPTZ)
// 
// import { Pool } from "pg";
import type { Ticket, TicketComment } from "@/lib/types";

const pool = new Pool({ connectionString: process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } });

function formatDateTime(dateString: string) {
  const date = new Date(dateString);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export async function listTickets(): Promise<Ticket[]> {
  const { rows } = await pool.query("SELECT * FROM tickets ORDER BY created_at DESC");
  return rows.map(row => ({
    ...row,
    created_at: formatDateTime(row.created_at),
    updated_at: formatDateTime(row.updated_at),
    comments: Array.isArray(row.comments) ? row.comments : JSON.parse(row.comments ?? "[]"),
  }));
}

// Helper to increment ticket_code
function incrementTicketCode(current: string | null): string {
  if (!current) return "TASK-AAA000000";
  const match = current.match(/^TASK-([A-Z]{3})(\d{6})$/i);
  if (!match) return "TASK-AAA000000";
  let [_, letters, numbers] = match;
  let num = parseInt(numbers, 10) + 1;
  if (num > 999999) {
    // Increment letters
    let chars = letters.split("");
    for (let i = chars.length - 1; i >= 0; i--) {
      if (chars[i] === "Z") {
        chars[i] = "A";
      } else {
        chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
        break;
      }
    }
    letters = chars.join("");
    num = 0;
  }
  return `TASK-${letters}${num.toString().padStart(6, "0")}`;
}

export async function createTicket(ticket: Omit<Ticket, "ticket_id" | "created_at" | "updated_at" | "comments" | "ticket_code">) {
  // Get the latest ticket_code
  const { rows } = await pool.query(
    `SELECT ticket_code FROM tickets WHERE ticket_code IS NOT NULL ORDER BY created_at DESC LIMIT 1`
  );
  const latestCode = rows[0]?.ticket_code ?? null;
  const newCode = incrementTicketCode(latestCode);

  const { tenant_id, branch_id, user_id, subject, description, status, priority, assigned_agent_id, author } = ticket;
  const insertResult = await pool.query(
    `INSERT INTO tickets (tenant_id, branch_id, user_id, subject, description, status, priority, assigned_agent_id, author, ticket_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [tenant_id, branch_id, user_id, subject, description, status, priority, assigned_agent_id, author, newCode]
  );
  return insertResult.rows[0];
}

export async function addTicketComment(ticket_id: number, comment: TicketComment) {
  await pool.query(
    `UPDATE tickets SET comments = comments || $1::jsonb, updated_at = NOW() WHERE ticket_id = $2`,
    [JSON.stringify([comment]), ticket_id]
  );
}

export async function getTicketById(ticket_id: number): Promise<Ticket | null> {
  const { rows } = await pool.query("SELECT * FROM tickets WHERE ticket_id = $1", [ticket_id]);
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    ...row,
    comments: Array.isArray(row.comments) ? row.comments : JSON.parse(row.comments ?? "[]"),
  };
}

export async function updateTicket(
  ticket_id: number,
  updates: Partial<Pick<Ticket, "status" | "priority" | "subject" | "description" | "comments" | "assigned_agent_id">>
): Promise<Ticket | null> {
  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = $${idx++}`);
    values.push(value);
  }
  // Set updated_at in Asia/Manila timezone
  fields.push(`updated_at = (NOW() AT TIME ZONE 'Asia/Manila')`);

  if (fields.length === 0) return null;

  values.push(ticket_id);

  const query = `
    UPDATE tickets
    SET ${fields.join(", ")}
    WHERE ticket_id = $${values.length}
    RETURNING *
  `;

  const { rows } = await pool.query(query, values);
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    ...row,
    comments: Array.isArray(row.comments) ? row.comments : JSON.parse(row.comments ?? "[]"),
  };
}
import * as React from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  getFilteredRowModel,
  getPaginationRowModel,
} from "@tanstack/react-table";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
}

export function DataTable<TData, TValue>({ columns, data }: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [pageIndex, setPageIndex] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);

  const prevDataLength = React.useRef(data.length);

  // Reset to first page when data or pageSize changes
  React.useEffect(() => {
    setPageIndex(0);
  }, [globalFilter, pageSize]);

  React.useEffect(() => {
    if (data.length !== prevDataLength.current) {
      setPageIndex(0);
      prevDataLength.current = data.length;
    }
  }, [data.length]);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter,
      pagination: { pageIndex, pageSize },
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: updater => {
      if (typeof updater === "function") {
        const next = updater({ pageIndex, pageSize });
        setPageIndex(next.pageIndex);
        setPageSize(next.pageSize);
      } else {
        setPageIndex(updater.pageIndex);
        setPageSize(updater.pageSize);
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: "auto",
  });

  return (
    <div className="overflow-x-auto">
      <div className="mb-2">
        <input
          className="border px-2 py-1 rounded w-64"
          placeholder="Search..."
          value={globalFilter ?? ""}
          onChange={e => setGlobalFilter(e.target.value)}
        />
      </div>
      
      <div className="flex items-center justify-between mt-2">
        <div>
          <button
            className="px-2 py-1 border rounded mr-2"
            onClick={() => setPageIndex(old => Math.max(old - 1, 0))}
            disabled={pageIndex === 0}
          >
            Previous
          </button>
          <button
            className="px-2 py-1 border rounded"
            onClick={() => setPageIndex(old => Math.min(old + 1, table.getPageCount() - 1))}
            disabled={pageIndex >= table.getPageCount() - 1}
          >
            Next
          </button>
          <span className="ml-4">
            Page{" "}
            <strong>
              {pageIndex + 1} of {table.getPageCount()}
            </strong>
          </span>
        </div>
        <div>
          <select
            className="border px-2 py-1 rounded"
            value={pageSize}
            onChange={e => setPageSize(Number(e.target.value))}
          >
            {[5, 10, 20, 50].map(size => (
              <option key={size} value={size}>
                Show {size}
              </option>
            ))}
          </select>
        </div>
      </div>
      <br></br>
      <table className="min-w-full border">
        <thead>
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th
                  key={header.id}
                  className="px-3 py-2 border-b bg-muted text-left cursor-pointer select-none"
                  onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getCanSort() && (
                    <span className="ml-1">
                      {header.column.getIsSorted() === "asc" ? "▲" : header.column.getIsSorted() === "desc" ? "▼" : ""}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr key={row.id}>
              {row.getVisibleCells().map(cell => (
                <td key={cell.id} className="px-3 py-2 border-b">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.getRowModel().rows.length === 0 && (
        <div className="p-4 text-center text-muted-foreground">No results.</div>
      )}
    </div>
  );
}
import { ColumnDef } from "@tanstack/react-table";
import { HotelRoom, SimpleRate } from "@/lib/types";
import { ROOM_AVAILABILITY_STATUS_TEXT, ROOM_CLEANING_STATUS_TEXT } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Edit, Trash2, Tags } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

export function getRoomColumns(
  availableRates: SimpleRate[],
  setSelectedRoom: (room: HotelRoom) => void,
  setIsEditDialogOpen: (open: boolean) => void,
  setIsAddDialogOpen: (open: boolean) => void,
  handleArchive: (room: HotelRoom) => void,
  isSubmitting: boolean
): ColumnDef<HotelRoom>[] {
  return [
    {
      header: "Room Information",
      accessorKey: "room_name",
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div>
            <div className="font-medium">{r.room_name}</div>
            <div className="text-xs text-muted-foreground">Room Number: {r.room_code}</div>
            <div className="text-xs text-muted-foreground">Floor: {r.floor ?? "N/A"}</div>
          </div>
        );
      },
    },
    {
      header: "Rates",
      accessorKey: "hotel_rate_id",
      cell: ({ row }) => {
        const r = row.original;
        return r.hotel_rate_id && r.hotel_rate_id.length > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <Tags className="h-4 w-4" />
                <span className="sr-only">View Associated Rates</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3 max-w-xs">
              <div className="text-sm">
                <p className="font-semibold mb-1 text-popover-foreground">Associated Rates:</p>
                <ul className="list-disc list-inside space-y-0.5 text-popover-foreground/90">
                  {availableRates
                    .filter((ar) => (r.hotel_rate_id ?? []).includes(ar.id))
                    .map((rate) => (
                      <li key={rate.id}>
                        {rate.name} (₱{typeof rate.price === "number" ? rate.price.toFixed(2) : "N/A"})
                      </li>
                    ))}
                  {r.hotel_rate_id
                    .filter((rateId) => !availableRates.some((ar) => ar.id === rateId))
                    .map((rateId) => (
                      <li key={rateId} className="text-xs text-muted-foreground italic">
                        Rate ID: {rateId} (Inactive/Not Found)
                      </li>
                    ))}
                </ul>
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          <span className="text-xs text-muted-foreground">N/A</span>
        );
      },
    },
    {
      header: "Availability",
      accessorKey: "is_available",
      cell: ({ row }) =>
        ROOM_AVAILABILITY_STATUS_TEXT[
          Number(row.original.is_available) as keyof typeof ROOM_AVAILABILITY_STATUS_TEXT
        ] || "Unknown",
    },
    {
      header: "Cleaning",
      accessorKey: "cleaning_status",
      cell: ({ row }) =>
        ROOM_CLEANING_STATUS_TEXT[
          Number(row.original.cleaning_status) as keyof typeof ROOM_CLEANING_STATUS_TEXT
        ] || "N/A",
    },
    {
      header: "Actions",
      id: "actions",
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="text-right space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedRoom(r);
                setIsEditDialogOpen(true);
                setIsAddDialogOpen(false);
              }}
            >
              <Edit className="mr-1 h-3 w-3" /> Edit
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isSubmitting}
              onClick={() => handleArchive(r)}
            >
              <Trash2 className="mr-1 h-3 w-3" /> Archive
            </Button>
          </div>
        );
      },
    },
  ];
}
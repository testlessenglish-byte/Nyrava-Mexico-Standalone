import React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

export interface NyravaPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (newPage: number) => void;
  onPageSizeChange?: (newPageSize: number) => void;
  pageSizeOptions?: number[];
  es?: boolean;
  className?: string;
}

export function NyravaPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
  es = true,
  className = "",
}: NyravaPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const fromRecord = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const toRecord = Math.min(total, safePage * pageSize);

  // Generate page numbers with smart ellipsis windowing
  const getPageNumbers = (): (number | "ellipsis")[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    if (safePage <= 4) {
      return [1, 2, 3, 4, 5, "ellipsis", totalPages];
    }

    if (safePage >= totalPages - 3) {
      return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }

    return [1, "ellipsis", safePage - 1, safePage, safePage + 1, "ellipsis", totalPages];
  };

  const pageNumbers = getPageNumbers();

  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-card border border-border/70 rounded-xl text-xs text-muted-foreground ${className}`}
    >
      {/* Left: Record summary count */}
      <div className="flex items-center gap-2">
        <span className="font-medium text-foreground">
          {es ? (
            <>
              Mostrando <span className="text-primary font-semibold">{fromRecord}–{toRecord}</span> de <span className="text-foreground font-semibold">{total}</span>
            </>
          ) : (
            <>
              Showing <span className="text-primary font-semibold">{fromRecord}–{toRecord}</span> of <span className="text-foreground font-semibold">{total}</span>
            </>
          )}
        </span>

        {/* Page size selector */}
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 ml-3 pl-3 border-l border-border/60">
            <span className="text-muted-foreground text-[11px] whitespace-nowrap">
              {es ? "Filas:" : "Rows:"}
            </span>
            <select
              value={pageSize}
              onChange={(e) => {
                const newSize = Number(e.target.value);
                onPageSizeChange(newSize);
                onPageChange(1); // Reset to page 1 on page size change
              }}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Right: Page navigation buttons */}
      <div className="flex items-center gap-1">
        {/* Previous page */}
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          aria-label={es ? "Página anterior" : "Previous page"}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border/70 bg-background text-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{es ? "Anterior" : "Previous"}</span>
        </button>

        {/* Desktop Page Numbers */}
        <div className="hidden sm:flex items-center gap-1">
          {pageNumbers.map((p, idx) => {
            if (p === "ellipsis") {
              return (
                <span key={`ellipsis-${idx}`} className="px-1.5 py-1 text-muted-foreground select-none">
                  …
                </span>
              );
            }

            const isCurrent = p === safePage;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                className={`min-w-[32px] h-8 px-2 rounded-lg text-xs font-medium transition-colors ${
                  isCurrent
                    ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                    : "border border-border/60 bg-background text-foreground hover:bg-muted"
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>

        {/* Mobile Page indicator */}
        <span className="sm:hidden px-2 text-xs text-foreground font-medium">
          {safePage} / {totalPages}
        </span>

        {/* Next page */}
        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          aria-label={es ? "Página siguiente" : "Next page"}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border/70 bg-background text-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          <span className="hidden sm:inline">{es ? "Siguiente" : "Next"}</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

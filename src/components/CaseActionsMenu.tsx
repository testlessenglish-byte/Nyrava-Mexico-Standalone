import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Archive, ArchiveRestore, Copy, Trash2, StopCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  renameCase, archiveCase, deleteCase, duplicateCase, requestCancel,
} from "@/lib/cases.functions";

type Props = {
  caseId: string;
  name: string;
  archived?: boolean;
  running?: boolean;
  onAfter?: () => void;
  /** When true, navigate back to /cases after delete */
  navigateAfterDelete?: boolean;
};

export function CaseActionsMenu({ caseId, name, archived, running, onAfter, navigateAfterDelete }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["cases"] });
    qc.invalidateQueries({ queryKey: ["case", caseId] });
    onAfter?.();
  };

  const rename = useServerFn(renameCase);
  const archive = useServerFn(archiveCase);
  const del = useServerFn(deleteCase);
  const dup = useServerFn(duplicateCase);
  const cancel = useServerFn(requestCancel);

  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState(name);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const renameM = useMutation({
    mutationFn: () => rename({ data: { caseId, name: newName.trim() } }),
    onSuccess: () => { toast.success("Renamed"); setRenameOpen(false); invalidate(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Rename failed"),
  });
  const archiveM = useMutation({
    mutationFn: () => archive({ data: { caseId, archived: !archived } }),
    onSuccess: () => { toast.success(archived ? "Unarchived" : "Archived"); invalidate(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Action failed"),
  });
  const deleteM = useMutation({
    mutationFn: () => del({ data: { caseId } }),
    onSuccess: () => {
      toast.success("Case deleted");
      setDeleteOpen(false);
      qc.setQueryData<Array<{ id: string }>>(["cases"], (old) => old?.filter((c) => c.id !== caseId));
      qc.setQueryData<{ cases?: Array<{ id: string }> }>(["adminStats"], (old) => (
        old ? { ...old, cases: old.cases?.filter((c) => c.id !== caseId) } : old
      ));
      invalidate();
      if (navigateAfterDelete) navigate({ to: "/cases" });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });
  const dupM = useMutation({
    mutationFn: () => dup({ data: { caseId } }),
    onSuccess: (r: { caseId: string }) => {
      toast.success("Duplicated — upload files to the new case");
      invalidate();
      navigate({ to: "/cases/$caseId", params: { caseId: r.caseId } });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Duplicate failed"),
  });
  const cancelM = useMutation({
    mutationFn: () => cancel({ data: { caseId } }),
    onSuccess: () => { toast.info("Cancel requested — will stop at next checkpoint"); invalidate(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Cancel failed"),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-secondary"
          aria-label="Case actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {running && (
            <>
              <DropdownMenuItem onSelect={() => cancelM.mutate()} className="text-warning">
                <StopCircle className="mr-2 h-4 w-4" /> Cancel processing
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => { setNewName(name); setRenameOpen(true); }}>
            <Pencil className="mr-2 h-4 w-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => dupM.mutate()}>
            <Copy className="mr-2 h-4 w-4" /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => archiveM.mutate()}>
            {archived ? <ArchiveRestore className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
            {archived ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDeleteOpen(true)} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename case</DialogTitle>
            <DialogDescription>Update the display name for this case.</DialogDescription>
          </DialogHeader>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={200} autoFocus />
          <DialogFooter>
            <button
              onClick={() => setRenameOpen(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"
            >Cancel</button>
            <button
              onClick={() => renameM.mutate()}
              disabled={renameM.isPending || !newName.trim() || newName.trim() === name}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
            >Save</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete case forever?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes “{name}” — every document, OCR page, finding,
              theory, report, and uploaded file is erased from the database and
              storage. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteM.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >Delete forever</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

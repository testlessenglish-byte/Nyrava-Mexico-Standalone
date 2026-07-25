import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MoreHorizontal, Ban, ShieldCheck, UserX } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { setUserBlocked, deleteUserAccount } from "@/lib/cases.functions";

type Props = {
  userId: string;
  email?: string | null;
  blocked?: boolean;
  /** Only super admins may permanently remove a user's account. */
  canRemove: boolean;
  /** Disables self-block / self-removal. */
  isSelf?: boolean;
  onAfter?: () => void;
};

export function UserActionsMenu({ userId, email, blocked, canRemove, isSelf, onAfter }: Props) {
  const qc = useQueryClient();
  const setBlockedFn = useServerFn(setUserBlocked);
  const removeFn = useServerFn(deleteUserAccount);
  const [removeOpen, setRemoveOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["adminStats"] });
    qc.invalidateQueries({ queryKey: ["adminUsersWithRoles"] });
    onAfter?.();
  };

  const blockM = useMutation({
    mutationFn: (next: boolean) => setBlockedFn({ data: { targetUserId: userId, blocked: next } }),
    onSuccess: (_r, next) => {
      toast.success(next ? "User blocked" : "User accepted / unblocked");
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Action failed"),
  });

  const removeM = useMutation({
    mutationFn: () => removeFn({ data: { targetUserId: userId } }),
    onSuccess: () => {
      toast.success("User removed");
      setRemoveOpen(false);
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Remove failed"),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          onClick={(e) => e.stopPropagation()}
          disabled={isSelf}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-secondary disabled:opacity-30"
          aria-label="User actions"
          title={isSelf ? "You can't act on your own account" : "User actions"}
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            onSelect={() => blockM.mutate(!blocked)}
            disabled={blockM.isPending}
            className={blocked ? "text-success" : "text-warning"}
          >
            {blocked ? <ShieldCheck className="mr-2 h-4 w-4" /> : <Ban className="mr-2 h-4 w-4" />}
            {blocked ? "Accept / Unblock" : "Block"}
          </DropdownMenuItem>
          {canRemove && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setRemoveOpen(true)} className="text-destructive">
                <UserX className="mr-2 h-4 w-4" /> Remove user
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {email || "this user"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes their sign-in access, role assignments, and profile.
              Their existing cases and documents are left in place. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeM.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

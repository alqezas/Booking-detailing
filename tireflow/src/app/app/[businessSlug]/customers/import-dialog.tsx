"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { importCustomers } from "./actions";

export function ImportDialog({ slug }: { slug: string }) {
  const t = useTranslations("customers");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}><Upload />{t("import")}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("import")}</DialogTitle>
          <DialogDescription>{t("importHelp")}</DialogDescription>
        </DialogHeader>
        <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        <DialogFooter>
          <Button
            disabled={!file || pending}
            onClick={() => start(async () => {
              if (!file || file.size > 2_000_000) return;
              const res = await importCustomers(slug, await file.text());
              if (res.ok) {
                toast.success(t("imported", { count: res.data!.imported }));
                setOpen(false);
                router.refresh();
              } else toast.error(tc("error"));
            })}
          >{tc("create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

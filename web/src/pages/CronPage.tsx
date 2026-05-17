import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  Clock,
  Pause,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { Button } from "@nous-research/ui/ui/components/button";
import { Select, SelectOption } from "@nous-research/ui/ui/components/select";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { H2 } from "@/components/NouiTypography";
import { api } from "@/lib/api";
import type { CronJob } from "@/lib/api";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useToast } from "@/hooks/useToast";
import { useConfirmDelete } from "@/hooks/useConfirmDelete";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { Toast } from "@/components/Toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n";
import { usePageHeader } from "@/contexts/usePageHeader";
import { PluginSlot } from "@/plugins";

function formatTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength
    ? value.slice(0, maxLength) + "..."
    : value;
}

function getJobPrompt(job: CronJob): string {
  return asText(job.prompt);
}

function getJobName(job: CronJob): string {
  return asText(job.name).trim();
}

function getJobTitle(job: CronJob): string {
  const name = getJobName(job);
  if (name) return name;

  const prompt = getJobPrompt(job);
  if (prompt) return truncateText(prompt, 60);

  const script = asText(job.script);
  if (script) return truncateText(script, 60);

  return job.id || "Cron job";
}

function getJobScheduleDisplay(job: CronJob): string {
  return (
    asText(job.schedule_display) ||
    asText(job.schedule?.display) ||
    asText(job.schedule?.expr) ||
    "—"
  );
}

function getJobState(job: CronJob): string {
  return asText(job.state) || (job.enabled === false ? "disabled" : "scheduled");
}

const STATUS_TONE: Record<string, "success" | "warning" | "destructive"> = {
  enabled: "success",
  scheduled: "success",
  paused: "warning",
  error: "destructive",
  completed: "destructive",
};

const DELIVERY_OPTIONS = [
  "local",
  "telegram",
  "discord",
  "slack",
  "email",
  "feishu",
] as const;

function splitDeliver(value?: string | null): { kind: string; target: string } {
  const raw = (value || "local").trim();
  if (raw.startsWith("feishu:")) {
    return {
      kind: "feishu",
      target: raw.slice("feishu:".length).trim(),
    };
  }
  return { kind: raw || "local", target: "" };
}

function buildDeliver(kind: string, target: string): string {
  if (kind === "feishu") {
    return target.trim() ? `feishu:${target.trim()}` : "feishu";
  }
  return kind;
}

export default function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast, showToast } = useToast();
  const { t } = useI18n();
  const { setEnd } = usePageHeader();

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState("");
  const [name, setName] = useState("");
  const closeCreateModal = useCallback(() => setCreateModalOpen(false), []);
  const createModalRef = useModalBehavior({
    open: createModalOpen,
    onClose: closeCreateModal,
  });
  const [deliver, setDeliver] = useState("local");
  const [deliverTarget, setDeliverTarget] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState("");
  const [editingSchedule, setEditingSchedule] = useState("");
  const [editingName, setEditingName] = useState("");
  const [editingDeliver, setEditingDeliver] = useState("local");
  const [editingDeliverTarget, setEditingDeliverTarget] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const loadJobs = useCallback(() => {
    api
      .getCronJobs()
      .then(setJobs)
      .catch(() => showToast(t.common.loading, "error"))
      .finally(() => setLoading(false));
  }, [showToast, t.common.loading]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const handleCreate = async () => {
    if (!prompt.trim() || !schedule.trim()) {
      showToast(`${t.cron.prompt} & ${t.cron.schedule} required`, "error");
      return;
    }
    setCreating(true);
    try {
      await api.createCronJob({
        prompt: prompt.trim(),
        schedule: schedule.trim(),
        name: name.trim() || undefined,
        deliver: buildDeliver(deliver, deliverTarget),
      });
      showToast(t.common.create + " ✓", "success");
      setPrompt("");
      setSchedule("");
      setName("");
      setDeliver("local");
      setDeliverTarget("");
      setCreateModalOpen(false);
      loadJobs();
    } catch (e) {
      showToast(`${t.config.failedToSave}: ${e}`, "error");
    } finally {
      setCreating(false);
    }
  };

  const startEdit = useCallback((job: CronJob) => {
    const parsedDeliver = splitDeliver(job.deliver);
    setEditingId(job.id);
    setEditingPrompt(getJobPrompt(job));
    setEditingSchedule(getJobScheduleDisplay(job));
    setEditingName(getJobName(job));
    setEditingDeliver(parsedDeliver.kind);
    setEditingDeliverTarget(parsedDeliver.target);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingPrompt("");
    setEditingSchedule("");
    setEditingName("");
    setEditingDeliver("local");
    setEditingDeliverTarget("");
    setSavingEdit(false);
  }, []);

  const handleSaveEdit = async () => {
    if (!editingId) return;
    if (!editingPrompt.trim() || !editingSchedule.trim()) {
      showToast(`${t.cron.prompt} & ${t.cron.schedule} required`, "error");
      return;
    }
    setSavingEdit(true);
    try {
      await api.updateCronJob(editingId, {
        prompt: editingPrompt.trim(),
        schedule: editingSchedule.trim(),
        name: editingName.trim() || undefined,
        deliver: buildDeliver(editingDeliver, editingDeliverTarget),
      });
      showToast(`${t.common.save} ✓`, "success");
      cancelEdit();
      loadJobs();
    } catch (e) {
      showToast(`${t.config.failedToSave}: ${e}`, "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const deliveryLabel = (value: string) => {
    switch (value) {
      case "local":
        return t.cron.delivery.local;
      case "telegram":
        return t.cron.delivery.telegram;
      case "discord":
        return t.cron.delivery.discord;
      case "slack":
        return t.cron.delivery.slack;
      case "email":
        return t.cron.delivery.email;
      case "feishu":
        return t.cron.delivery.feishu;
      default:
        return value;
    }
  };

  const handlePauseResume = async (job: CronJob) => {
    try {
      const isPaused = getJobState(job) === "paused";
      if (isPaused) {
        await api.resumeCronJob(job.id);
        showToast(
          `${t.cron.resume}: "${truncateText(getJobTitle(job), 30)}"`,
          "success",
        );
      } else {
        await api.pauseCronJob(job.id);
        showToast(
          `${t.cron.pause}: "${truncateText(getJobTitle(job), 30)}"`,
          "success",
        );
      }
      loadJobs();
    } catch (e) {
      showToast(`${t.status.error}: ${e}`, "error");
    }
  };

  const handleTrigger = async (job: CronJob) => {
    try {
      await api.triggerCronJob(job.id);
      showToast(
        `${t.cron.triggerNow}: "${truncateText(getJobTitle(job), 30)}"`,
        "success",
      );
      loadJobs();
    } catch (e) {
      showToast(`${t.status.error}: ${e}`, "error");
    }
  };

  const jobDelete = useConfirmDelete({
    onDelete: useCallback(
      async (id: string) => {
        const job = jobs.find((j) => j.id === id);
        try {
          await api.deleteCronJob(id);
          showToast(
            `${t.common.delete}: "${job ? truncateText(getJobTitle(job), 30) : id}"`,
            "success",
          );
          loadJobs();
        } catch (e) {
          showToast(`${t.status.error}: ${e}`, "error");
          throw e;
        }
      },
      [jobs, loadJobs, showToast, t.common.delete, t.status.error],
    ),
  });

  useLayoutEffect(() => {
    setEnd(
      <Button
        size="sm"
        onClick={() => setCreateModalOpen(true)}
      >
        <Plus className="h-3 w-3" />
        {t.common.create}
      </Button>,
    );
    return () => {
      setEnd(null);
    };
  }, [setEnd, t.common.create, loading]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="text-2xl text-primary" />
      </div>
    );
  }

  const pendingJob = jobDelete.pendingId
    ? jobs.find((j) => j.id === jobDelete.pendingId)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PluginSlot name="cron:top" />
      <Toast toast={toast} />

      <DeleteConfirmDialog
        open={jobDelete.isOpen}
        onCancel={jobDelete.cancel}
        onConfirm={jobDelete.confirm}
        title={t.cron.confirmDeleteTitle}
        description={
          pendingJob
            ? `"${truncateText(getJobTitle(pendingJob), 40)}" — ${
                t.cron.confirmDeleteMessage
              }`
            : t.cron.confirmDeleteMessage
        }
        loading={jobDelete.isDeleting}
      />

      {createModalOpen && (
        <div
          ref={createModalRef}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/85 backdrop-blur-sm p-4"
          onClick={(e) => e.target === e.currentTarget && setCreateModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-cron-title"
        >
          <div className="relative flex w-full max-w-lg flex-col border border-border bg-card shadow-2xl">
            <Button
              ghost
              size="icon"
              onClick={() => setCreateModalOpen(false)}
              className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              aria-label={t.common.close}
            >
              <X />
            </Button>

            <header className="border-b border-border p-5 pb-3">
              <h2
                id="create-cron-title"
                className="font-display text-base tracking-wider uppercase"
              >
                {t.cron.newJob}
              </h2>
            </header>

            <div className="grid gap-4 p-5">
              <div className="grid gap-2">
                <Label htmlFor="cron-name">{t.cron.nameOptional}</Label>
                <Input
                  id="cron-name"
                  autoFocus
                  placeholder={t.cron.namePlaceholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="cron-prompt">{t.cron.prompt}</Label>
                <textarea
                  id="cron-prompt"
                  className="flex min-h-[80px] w-full border border-border bg-background/40 px-3 py-2 text-sm font-courier shadow-sm placeholder:text-muted-foreground focus-visible:border-foreground/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30"
                  placeholder={t.cron.promptPlaceholder}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="cron-schedule">{t.cron.schedule}</Label>
                  <Input
                    id="cron-schedule"
                    placeholder={t.cron.schedulePlaceholder}
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="cron-deliver">{t.cron.deliverTo}</Label>
                  <Select
                    id="cron-deliver"
                    value={deliver}
                    onValueChange={(v) => setDeliver(v)}
                  >
                    {DELIVERY_OPTIONS.map((option) => (
                      <SelectOption key={option} value={option}>
                        {deliveryLabel(option)}
                      </SelectOption>
                    ))}
                  </Select>
                </div>
              </div>

              {deliver === "feishu" && (
                <div className="grid gap-2">
                  <Label htmlFor="cron-deliver-target">{t.cron.deliverTarget}</Label>
                  <Input
                    id="cron-deliver-target"
                    placeholder={t.cron.deliverTargetPlaceholder}
                    value={deliverTarget}
                    onChange={(e) => setDeliverTarget(e.target.value)}
                  />
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={creating}
                  prefix={creating ? <Spinner /> : <Plus />}
                >
                  {creating ? t.common.creating : t.common.create}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingId && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/85 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) cancelEdit();
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cron-edit-title"
        >
          <div className="relative w-full max-w-2xl border border-border bg-card shadow-2xl">
            <Button
              ghost
              size="icon"
              onClick={cancelEdit}
              className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              aria-label={t.common.close}
            >
              <X />
            </Button>

            <div className="flex flex-col gap-4 p-6">
              <div>
                <H2
                  id="cron-edit-title"
                  variant="sm"
                  mondwest
                  className="tracking-wider uppercase"
                >
                  {t.cron.editJob}
                </H2>
              </div>

              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="cron-edit-name">{t.cron.nameOptional}</Label>
                  <Input
                    id="cron-edit-name"
                    placeholder={t.cron.namePlaceholder}
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="cron-edit-prompt">{t.cron.prompt}</Label>
                  <textarea
                    id="cron-edit-prompt"
                    className="flex min-h-[80px] w-full border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder={t.cron.promptPlaceholder}
                    value={editingPrompt}
                    onChange={(e) => setEditingPrompt(e.target.value)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="cron-edit-schedule">{t.cron.schedule}</Label>
                    <Input
                      id="cron-edit-schedule"
                      placeholder={t.cron.schedulePlaceholder}
                      value={editingSchedule}
                      onChange={(e) => setEditingSchedule(e.target.value)}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="cron-edit-deliver">{t.cron.deliverTo}</Label>
                    <Select
                      id="cron-edit-deliver"
                      value={editingDeliver}
                      onValueChange={(v) => setEditingDeliver(v)}
                    >
                      {DELIVERY_OPTIONS.map((option) => (
                        <SelectOption key={option} value={option}>
                          {deliveryLabel(option)}
                        </SelectOption>
                      ))}
                    </Select>
                  </div>
                </div>

                {editingDeliver === "feishu" && (
                  <div className="grid gap-2">
                    <Label htmlFor="cron-edit-deliver-target">
                      {t.cron.deliverTarget}
                    </Label>
                    <Input
                      id="cron-edit-deliver-target"
                      placeholder={t.cron.deliverTargetPlaceholder}
                      value={editingDeliverTarget}
                      onChange={(e) => setEditingDeliverTarget(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button outlined onClick={cancelEdit} disabled={savingEdit}>
                  {t.common.cancel}
                </Button>
                <Button
                  onClick={handleSaveEdit}
                  disabled={savingEdit}
                  prefix={<Save />}
                >
                  {savingEdit ? t.common.saving : t.common.save}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <H2
          variant="sm"
          className="flex items-center gap-2 text-muted-foreground"
        >
          <Clock className="h-4 w-4" />
          {t.cron.scheduledJobs} ({jobs.length})
        </H2>

        {jobs.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {t.cron.noJobs}
            </CardContent>
          </Card>
        )}

        {jobs.map((job) => {
          const state = getJobState(job);
          const promptText = getJobPrompt(job);
          const title = getJobTitle(job);
          const hasName = Boolean(getJobName(job));
          const deliverValue = asText(job.deliver);

          return (
            <Card key={job.id}>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {title}
                    </span>
                    <Badge tone={STATUS_TONE[state] ?? "secondary"}>
                      {state}
                    </Badge>
                    {deliverValue && deliverValue !== "local" && (
                      <Badge tone="outline">{deliverValue}</Badge>
                    )}
                  </div>
                  {hasName && promptText && (
                    <p className="mb-1 truncate text-xs text-muted-foreground">
                      {truncateText(promptText, 100)}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="font-mono">{getJobScheduleDisplay(job)}</span>
                    <span>
                      {t.cron.last}: {formatTime(job.last_run_at)}
                    </span>
                    <span>
                      {t.cron.next}: {formatTime(job.next_run_at)}
                    </span>
                  </div>
                  {job.last_error && (
                    <p className="mt-1 text-xs text-destructive">
                      {job.last_error}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    ghost
                    size="icon"
                    title={t.cron.edit}
                    aria-label={t.cron.edit}
                    onClick={() => startEdit(job)}
                  >
                    <Pencil />
                  </Button>

                  <Button
                    ghost
                    size="icon"
                    title={state === "paused" ? t.cron.resume : t.cron.pause}
                    aria-label={state === "paused" ? t.cron.resume : t.cron.pause}
                    onClick={() => handlePauseResume(job)}
                    className={state === "paused" ? "text-success" : "text-warning"}
                  >
                    {state === "paused" ? <Play /> : <Pause />}
                  </Button>

                  <Button
                    ghost
                    size="icon"
                    title={t.cron.triggerNow}
                    aria-label={t.cron.triggerNow}
                    onClick={() => handleTrigger(job)}
                  >
                    <Zap />
                  </Button>

                  <Button
                    ghost
                    destructive
                    size="icon"
                    title={t.common.delete}
                    aria-label={t.common.delete}
                    onClick={() => jobDelete.requestDelete(job.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <PluginSlot name="cron:bottom" />
    </div>
  );
}

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
import { H2 } from "@nous-research/ui/ui/components/typography/h2";
import { api } from "@/lib/api";
import type { CronJob, CronDeliveryTarget, ProfileInfo, SkillInfo } from "@/lib/api";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import {
  DEFAULT_SCHEDULE_STATE,
  ScheduleBuilder,
} from "@/components/ScheduleBuilder";
import {
  buildScheduleString,
  describeSchedule,
  englishOrdinal,
  type ScheduleBuilderState,
  type ScheduleDescribeStrings,
} from "@/lib/schedule";
import { useToast } from "@nous-research/ui/hooks/use-toast";
import { useConfirmDelete } from "@nous-research/ui/hooks/use-confirm-delete";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { Toast } from "@nous-research/ui/ui/components/toast";
import { Card, CardContent } from "@nous-research/ui/ui/components/card";
import { Input } from "@nous-research/ui/ui/components/input";
import { Label } from "@nous-research/ui/ui/components/label";
import { useI18n } from "@/i18n";
import { usePageHeader } from "@/contexts/usePageHeader";
import { PluginSlot } from "@/plugins";
import { Segmented } from "@nous-research/ui/ui/components/segmented";
import { AutomationBlueprints } from "@/components/AutomationBlueprints";
import { cn, themedBody } from "@/lib/utils";

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

/** Compact multi-select for attaching skills to a cron job.
 *
 * A checkbox list (native inputs — the `onValueChange` rule is Select-only)
 * capped to a scrollable box. Skills already on the job but missing from the
 * available list (e.g. removed from disk, or the job was created via CLI in
 * another profile) are still rendered so saving doesn't silently drop them.
 */
function SkillsPicker({
  id,
  available,
  selected,
  onChange,
  emptyLabel,
}: {
  id: string;
  available: SkillInfo[];
  selected: string[];
  onChange: (skills: string[]) => void;
  emptyLabel: string;
}) {
  const names = available.map((s) => s.name);
  const orphaned = selected.filter((s) => !names.includes(s));
  const all = [...orphaned.map((name) => ({ name, description: "" })), ...available];

  if (all.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  const toggle = (name: string, checked: boolean) => {
    if (checked) onChange([...selected, name]);
    else onChange(selected.filter((s) => s !== name));
  };

  return (
    <div
      id={id}
      className="max-h-36 overflow-y-auto border border-border bg-background/40 p-1"
    >
      {all.map((skill) => (
        <label
          key={skill.name}
          className="flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-muted/40"
          title={skill.description || undefined}
        >
          <input
            type="checkbox"
            className="accent-foreground"
            checked={selected.includes(skill.name)}
            onChange={(e) => toggle(skill.name, e.target.checked)}
          />
          <span className="font-mono-ui truncate">{skill.name}</span>
        </label>
      ))}
    </div>
  );
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

function getJobScheduleDisplay(
  job: CronJob,
  strings: ScheduleDescribeStrings,
): string {
  // Prefer a structured render so cron expressions like
  // ``30 14 * * 1,3,5`` surface as "Weekly on Mon, Wed, Fri at 14:30"
  // in the list instead of the raw five-field gibberish. Falls back
  // through the existing chain (``schedule_display`` from the backend,
  // then the structured ``display`` field, then the raw ``expr``) so
  // legacy job rows still render *something* meaningful.
  return describeSchedule(
    job.schedule,
    asText(job.schedule_display) || asText(job.schedule?.display),
    strings,
  );
}

function getJobState(job: CronJob): string {
  return asText(job.state) || (job.enabled === false ? "disabled" : "scheduled");
}

function getJobProfile(job: CronJob): string {
  return asText(job.profile) || asText(job.profile_name) || "default";
}

function getJobKey(job: CronJob): string {
  return `${getJobProfile(job)}:${job.id}`;
}

function splitJobKey(key: string): { profile: string; id: string } {
  const idx = key.indexOf(":");
  if (idx === -1) return { profile: "default", id: key };
  return { profile: key.slice(0, idx) || "default", id: key.slice(idx + 1) };
}

function profileLabel(profile: string): string {
  return profile === "default" ? "default" : profile;
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

function fallbackDeliveryTarget(id: string): CronDeliveryTarget {
  return {
    id,
    name: id === "local" ? "Local" : id.charAt(0).toUpperCase() + id.slice(1),
    home_target_set: true,
    home_env_var: null,
  };
}

function mergeDeliveryTargets(
  targets: CronDeliveryTarget[],
): CronDeliveryTarget[] {
  const seen = new Set(targets.map((target) => target.id));
  const merged = [...targets];
  for (const option of DELIVERY_OPTIONS) {
    if (!seen.has(option)) {
      merged.push(fallbackDeliveryTarget(option));
    }
  }
  return merged;
}

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
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [selectedProfile, setSelectedProfile] = useState("all");
  const [view, setView] = useState<"jobs" | "blueprints">("jobs");
  const [loading, setLoading] = useState(true);
  const { toast, showToast } = useToast();
  const { t, locale } = useI18n();
  const { setEnd } = usePageHeader();

  // Translation surface for the human-readable schedule describer.
  // English ordinals are a special case ("1st", "2nd", "23rd"); every
  // other locale falls back to the plain numeric form, which avoids
  // shipping incorrect grammar (e.g. naive "1th"/"2th" suffixes that
  // don't exist in most languages).
  //
  // Built inline (not memoized) — the cron page renders a small job
  // list, this is single-digit microseconds, and a useMemo here would
  // just add boilerplate.
  const scheduleDescribeStrings: ScheduleDescribeStrings = {
    ...t.cron.scheduleDescribe,
    weekdaysShort: t.cron.scheduleModes.weekdaysShort,
    ordinal: locale === "en" ? englishOrdinal : (n: number) => String(n),
  };

  // New job modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  // The schedule is now constructed via the ScheduleBuilder; we keep
  // the full builder state so flipping between modes during edit
  // doesn't erase the user's intermediate inputs. The actual string
  // sent to the backend is derived via ``buildScheduleString`` at
  // submit time.
  const [scheduleState, setScheduleState] = useState<ScheduleBuilderState>(
    DEFAULT_SCHEDULE_STATE,
  );
  const [name, setName] = useState("");
  const closeCreateModal = useCallback(() => setCreateModalOpen(false), []);
  const createModalRef = useModalBehavior({
    open: createModalOpen,
    onClose: closeCreateModal,
  });
  const [deliver, setDeliver] = useState("local");
  const [deliverTarget, setDeliverTarget] = useState("");
  const [jobSkills, setJobSkills] = useState<string[]>([]);
  const [deliveryTargets, setDeliveryTargets] = useState<CronDeliveryTarget[]>([
    fallbackDeliveryTarget("local"),
  ]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState("");
  const [editingSchedule, setEditingSchedule] = useState("");
  const [editingName, setEditingName] = useState("");
  const [editingDeliver, setEditingDeliver] = useState("local");
  const [editingDeliverTarget, setEditingDeliverTarget] = useState("");
  const [editingProfile, setEditingProfile] = useState("default");
  const [savingEdit, setSavingEdit] = useState(false);
  const createProfile = selectedProfile === "all" ? "default" : selectedProfile;

  const [editingSkills, setEditingSkills] = useState<string[]>([]);

  // Skills installed in the profile a job will run under, for the
  // attach-skill selector (parity with `hermes cron edit --add-skill`).
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([]);

  const loadJobs = useCallback(() => {
    api
      .getCronJobs(selectedProfile)
      .then(setJobs)
      .catch(() => showToast(t.common.loading, "error"))
      .finally(() => setLoading(false));
  }, [selectedProfile, showToast, t.common.loading]);

  useEffect(() => {
    api
      .getProfiles()
      .then((res) => setProfiles(res.profiles))
      .catch(() => setProfiles([]));
  }, []);

  useEffect(() => {
    api
      .getCronDeliveryTargets()
      .then((res) => setDeliveryTargets(mergeDeliveryTargets(res.targets)))
      .catch(() =>
        // Fall back to local-only so the modal still works if the endpoint fails.
        setDeliveryTargets(mergeDeliveryTargets([fallbackDeliveryTarget("local")])),
      );
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Load installed skills for the profile new jobs will be created under.
  // "" / "default" maps to the dashboard's own profile via the optional
  // ?profile= scoping on /api/skills.
  useEffect(() => {
    let cancelled = false;
    api
      .getSkills(createProfile === "default" ? undefined : createProfile)
      .then((s) => {
        if (!cancelled)
          setAvailableSkills(
            [...s].sort((a, b) => a.name.localeCompare(b.name)),
          );
      })
      .catch(() => !cancelled && setAvailableSkills([]));
    return () => {
      cancelled = true;
    };
  }, [createProfile]);

  const scheduleString = buildScheduleString(scheduleState);

  // Label for a delivery option. Configured platforms missing their cron home
  // channel are still offered (option B), annotated so the user knows what to
  // fix rather than wondering why delivery silently no-ops.
  const deliverLabel = useCallback(
    (target: CronDeliveryTarget): string => {
      const base = target.id === "local" ? t.cron.delivery.local : target.name;
      if (target.id !== "local" && !target.home_target_set) {
        const hint = t.cron.delivery.needsHomeChannel ?? "set a home channel first";
        return `${base} — ${hint}`;
      }
      return base;
    },
    [t.cron.delivery],
  );

  const renderDeliverOptions = useCallback(
    () =>
      deliveryTargets.map((target) => (
        <SelectOption key={target.id} value={target.id}>
          {deliverLabel(target)}
        </SelectOption>
      )),
    [deliveryTargets, deliverLabel],
  );

  // The edit modal must always show the job's current target, even if that
  // platform is no longer configured (e.g. job created via CLI, or the
  // gateway was later removed) — otherwise the value would silently vanish
  // from the dropdown and saving would drop it.
  const renderEditDeliverOptions = useCallback(
    (current: string) => {
      const known = new Set(deliveryTargets.map((target) => target.id));
      const options = deliveryTargets.map((target) => (
        <SelectOption key={target.id} value={target.id}>
          {deliverLabel(target)}
        </SelectOption>
      ));
      if (current && !known.has(current)) {
        options.push(
          <SelectOption key={current} value={current}>
            {current}
          </SelectOption>,
        );
      }
      return options;
    },
    [deliveryTargets, deliverLabel],
  );

  const onlyLocalAvailable =
    deliveryTargets.filter((target) => target.id !== "local").length === 0;

  const handleCreate = async () => {
    if (!prompt.trim() || !scheduleString) {
      showToast(`${t.cron.prompt} & ${t.cron.schedule} required`, "error");
      return;
    }
    setCreating(true);
    try {
      await api.createCronJob(
        {
          prompt: prompt.trim(),
          schedule: scheduleString,
          name: name.trim() || undefined,
          deliver: buildDeliver(deliver, deliverTarget),
          skills: jobSkills.length > 0 ? jobSkills : undefined,
        },
        createProfile,
      );
      showToast(t.common.create + " ✓", "success");
      setPrompt("");
      setScheduleState(DEFAULT_SCHEDULE_STATE);
      setName("");
      setDeliver("local");
      setDeliverTarget("");
      setJobSkills([]);
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
    setEditingSchedule(getJobScheduleDisplay(job, scheduleDescribeStrings));
    setEditingName(getJobName(job));
    setEditingDeliver(parsedDeliver.kind);
    setEditingDeliverTarget(parsedDeliver.target);
    setEditingProfile(getJobProfile(job));
    setEditingSkills(Array.isArray(job.skills) ? job.skills.filter(Boolean) : []);
  }, [scheduleDescribeStrings]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingPrompt("");
    setEditingSchedule("");
    setEditingName("");
    setEditingDeliver("local");
    setEditingDeliverTarget("");
    setEditingProfile("default");
    setEditingSkills([]);
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
      await api.updateCronJob(
        editingId,
        {
          prompt: editingPrompt.trim(),
          schedule: editingSchedule.trim(),
          name: editingName.trim(),
          deliver: buildDeliver(editingDeliver, editingDeliverTarget),
          skills: editingSkills,
        },
        editingProfile,
      );
      showToast(`${t.common.save} ✓`, "success");
      cancelEdit();
      loadJobs();
    } catch (e) {
      showToast(`${t.config.failedToSave}: ${e}`, "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const handlePauseResume = async (job: CronJob) => {
    try {
      const isPaused = getJobState(job) === "paused";
      const profile = getJobProfile(job);
      if (isPaused) {
        await api.resumeCronJob(job.id, profile);
        showToast(
          `${t.cron.resume}: "${truncateText(getJobTitle(job), 30)}"`,
          "success",
        );
      } else {
        await api.pauseCronJob(job.id, profile);
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
      await api.triggerCronJob(job.id, getJobProfile(job));
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
      async (key: string) => {
        const { profile, id } = splitJobKey(key);
        const job = jobs.find((j) => getJobKey(j) === key);
        try {
          await api.deleteCronJob(id, profile);
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
        className="uppercase"
        size="sm"
        onClick={() => setCreateModalOpen(true)}
        prefix={<Plus className="h-3 w-3" />}
      >
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
    ? jobs.find((j) => getJobKey(j) === jobDelete.pendingId)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PluginSlot name="cron:top" />
      <Toast toast={toast} />

      <Segmented
        value={view}
        onChange={(v) => setView(v as "jobs" | "blueprints")}
        options={[
          { value: "jobs", label: "Jobs" },
          { value: "blueprints", label: "Blueprints" },
        ]}
      />

      {view === "blueprints" && (
        <AutomationBlueprints
          profile={selectedProfile === "all" ? "default" : selectedProfile}
          onCreated={loadJobs}
        />
      )}


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
          <div
            className={cn(
              themedBody,
              "relative flex w-full max-w-lg flex-col border border-border bg-card shadow-2xl",
            )}
          >
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
                className="font-mondwest text-display text-base tracking-wider"
              >
                {t.cron.newJob}
              </h2>
            </header>

            <div className="grid gap-4 p-5">
              <div className="grid gap-2">
                <Label htmlFor="cron-profile">Profile</Label>
                <Select
                  id="cron-profile"
                  value={createProfile}
                  onValueChange={(v) => setSelectedProfile(v)}
                >
                  {profiles.map((profile) => (
                    <SelectOption key={profile.name} value={profile.name}>
                      {profileLabel(profile.name)}
                    </SelectOption>
                  ))}
                </Select>
              </div>

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

              <ScheduleBuilder
                value={scheduleState}
                onChange={setScheduleState}
              />

              <div className="grid gap-2">
                <Label htmlFor="cron-deliver">{t.cron.deliverTo}</Label>
                <Select
                  id="cron-deliver"
                  value={deliver}
                  onValueChange={(v) => setDeliver(v)}
                >
                  {renderDeliverOptions()}
                </Select>
                {onlyLocalAvailable && (
                  <p className="text-xs text-muted-foreground">
                    {t.cron.delivery.noneConfigured ??
                      "No messaging platforms configured. Set one up under Channels to deliver reports."}
                  </p>
                )}
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

              <div className="grid gap-2">
                <Label htmlFor="cron-skills">Skills (optional)</Label>
                <SkillsPicker
                  id="cron-skills"
                  available={availableSkills}
                  selected={jobSkills}
                  onChange={setJobSkills}
                  emptyLabel="No skills installed for this profile."
                />
                <p className="text-xs text-muted-foreground">
                  Selected skills are loaded before the prompt runs; the cron
                  sets when, the skill sets how.
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  className="uppercase"
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
          <div
            className={cn(
              themedBody,
              "relative w-full max-w-2xl border border-border bg-card shadow-2xl",
            )}
          >
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
                      {renderEditDeliverOptions(editingDeliver)}
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

              <div className="grid gap-2">
                <Label htmlFor="edit-cron-skills">Skills</Label>
                <SkillsPicker
                  id="edit-cron-skills"
                  available={availableSkills}
                  selected={editingSkills}
                  onChange={setEditingSkills}
                  emptyLabel="No skills installed for this profile."
                />
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

      {view === "jobs" && (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <H2
            variant="sm"
            className="flex items-center gap-2 text-muted-foreground"
          >
            <Clock className="h-4 w-4" />
            {t.cron.scheduledJobs} ({jobs.length})
          </H2>

          <div className="grid gap-1 min-w-[220px]">
            <Label htmlFor="cron-profile-filter">Profile</Label>
            <Select
              id="cron-profile-filter"
              value={selectedProfile}
              onValueChange={(v) => setSelectedProfile(v)}
            >
              <SelectOption value="all">All profiles</SelectOption>
              {profiles.map((profile) => (
                <SelectOption key={profile.name} value={profile.name}>
                  {profileLabel(profile.name)}
                </SelectOption>
              ))}
            </Select>
          </div>
        </div>

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
          const deliver = asText(job.deliver);
          const profile = getJobProfile(job);
          const jobKey = getJobKey(job);

          return (
            <Card key={jobKey}>
              <CardContent className="flex items-start gap-4 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm truncate">
                      {title}
                    </span>
                    <Badge tone={STATUS_TONE[state] ?? "secondary"}>
                      {state}
                    </Badge>
                    <Badge tone="outline">{profileLabel(profile)}</Badge>
                    {deliver && deliver !== "local" && (
                      <Badge tone="outline">{deliver}</Badge>
                    )}
                    {Array.isArray(job.skills) && job.skills.length > 0 && (
                      <Badge tone="outline" title={job.skills.join(", ")}>
                        {job.skills.length === 1
                          ? job.skills[0]
                          : `${job.skills.length} skills`}
                      </Badge>
                    )}
                  </div>
                  {hasName && promptText && (
                    <p className="mb-1 truncate text-xs text-muted-foreground">
                      {truncateText(promptText, 100)}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="font-mono-ui">
                      {getJobScheduleDisplay(job, scheduleDescribeStrings)}
                    </span>
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
                    onClick={() => jobDelete.requestDelete(jobKey)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      )}

      <PluginSlot name="cron:bottom" />
    </div>
  );
}

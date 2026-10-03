import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getBrowserInstallationId, newUuid, rememberVisit } from '../installation';
import { portalApi, type FormField, type QueueConfig } from '../portalApi';
import { Card, Loading, Notice, PrimaryButton, SecondaryButton, Shell } from '../ui';
import { JourneyBuilder } from '../../shared/journey/JourneyBuilder';
import { journeyProblems } from '../../shared/journey/journeyRules';

/**
 * ADR-068: queue chosen → services → the queue's own questions → identity
 * check if the queue requires one → join → live tracking.
 *
 * Every rule (schedule, capacity, repeat visits, one active visit per
 * installation per queue) is enforced by the backend when joining; this page
 * shows the queue's requirements and the backend's answer, nothing more.
 */
export function JoinPage() {
  const { publicCode = '', queueId = '' } = useParams();
  const navigate = useNavigate();
  const [config, setConfig] = useState<QueueConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [email, setEmail] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [proof, setProof] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt to join, so a double tap or a retry never makes two visits.
  const idempotencyKey = useMemo(() => newUuid(), []);

  useEffect(() => {
    portalApi
      .queueConfig(queueId)
      .then((loaded) => {
        setConfig(loaded);
        // ADR-070: start from the queue's suggested order, if it has one.
        if (loaded.allowMultipleServices && loaded.recommendedJourney?.length) {
          setSelected(loaded.recommendedJourney.filter((id) => loaded.services.some((s) => s.id === id)));
        }
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [queueId]);

  if (loadError) {
    return (
      <Shell title="Queue not available">
        <Notice tone="error">{loadError}</Notice>
      </Shell>
    );
  }
  if (!config) return <Loading label="Loading…" />;

  const blocked =
    config.status !== 'ACTIVE'
      ? 'This queue is not taking new arrivals right now.'
      : !config.schedule.acceptingJoins
        ? (config.schedule.message ?? 'This queue is closed right now.')
        : config.identity.configurationRequired || config.services.length === 0
          ? 'This queue is not open to join yet.'
          : null;

  const needsEmail = config.identity.requiresVerifiedEmail;
  const missingRequired = config.formFields.some((field) => {
    if (!field.required) return false;
    const value = answers[field.key];
    return field.type === 'checkbox' ? value !== true : value === undefined || String(value).trim() === '';
  });
  const journeyServices = config.services.map((s) => ({
    id: s.id,
    name: s.serviceName,
    maxOccurrencesPerJourney: s.maxOccurrencesPerJourney,
  }));
  const journeyInvalid = config.allowMultipleServices && journeyProblems(selected, journeyServices).length > 0;
  const canJoin =
    !blocked && selected.length > 0 && !journeyInvalid && !missingRequired && (!needsEmail || proof) && !busy;

  function toggleService(id: string) {
    setSelected([id]);
  }

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      const started = await portalApi.startEmailVerification(queueId, email);
      setVerificationId(started.verificationId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    if (!verificationId) return;
    setError(null);
    setBusy(true);
    try {
      const confirmed = await portalApi.confirmEmailVerification(verificationId, code, email);
      setProof(confirmed.verificationProof);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    if (!canJoin) return;
    setError(null);
    setBusy(true);
    try {
      const token = await portalApi.join({
        queueId,
        serviceIds: selected,
        deviceIdentifier: getBrowserInstallationId(),
        formData: answers,
        emailVerificationProof: proof ?? undefined,
        idempotencyKey,
      });
      rememberVisit({
        tokenId: token.id,
        serialNumber: token.serialNumber,
        queueName: config!.name,
        organizationCode: publicCode || null,
        joinedAt: new Date().toISOString(),
      });
      navigate(`/visit/token/${token.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Shell title={config.name} subtitle={config.description ?? undefined}>
      {blocked ? (
        <Notice tone="warn">{blocked}</Notice>
      ) : (
        <form onSubmit={(event) => void join(event)} className="space-y-4">
          {config.allowMultipleServices ? (
            <Card>
              <h2 className="text-base font-semibold">Your services, in order</h2>
              <p className="mt-1 text-sm text-muted">
                Add the services you need and arrange them in the order you want to be served. Drag a
                step by its handle, or use the arrows. Once you join, the order is fixed.
              </p>
              <div className="mt-3">
                <JourneyBuilder
                  idPrefix="portal-journey"
                  services={journeyServices}
                  steps={selected}
                  onChange={setSelected}
                  emptyMessage="No services yet. Add one below."
                />
              </div>
            </Card>
          ) : (
          <Card>
            <fieldset>
              <legend className="text-base font-semibold">Choose a service</legend>
              <div className="mt-3 space-y-2">
                {config.services.map((service) => (
                  <label
                    key={service.id}
                    className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border px-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
                  >
                    <input
                      type="radio"
                      name="service"
                      checked={selected.includes(service.id)}
                      onChange={() => toggleService(service.id)}
                      className="h-5 w-5"
                    />
                    <span className="flex-1">
                      <span className="block font-medium">{service.serviceName}</span>
                      {service.description && <span className="block text-xs text-muted">{service.description}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </Card>
          )}

          {config.formFields.length > 0 && (
            <Card>
              <h2 className="text-base font-semibold">Your details</h2>
              <div className="mt-3 space-y-3">
                {config.formFields.map((field) => (
                  <FieldInput
                    key={field.id}
                    field={field}
                    value={answers[field.key]}
                    onChange={(value) => setAnswers((current) => ({ ...current, [field.key]: value }))}
                  />
                ))}
              </div>
            </Card>
          )}

          {needsEmail && (
            <Card>
              <h2 className="text-base font-semibold">Verify your email</h2>
              <p className="mt-1 text-sm text-muted">
                This queue limits how often one person may return, so it needs to know who you are. We will email you a code.
              </p>
              {proof ? (
                <div className="mt-3">
                  <Notice tone="ok">Email verified.</Notice>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <label className="block text-sm font-medium">
                    Email
                    <input
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-1 h-12 w-full rounded-xl border border-border-strong bg-surface px-3 text-base"
                    />
                  </label>
                  {verificationId ? (
                    <>
                      <label className="block text-sm font-medium">
                        6-digit code
                        <input
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          value={code}
                          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                          className="mt-1 h-12 w-full rounded-xl border border-border-strong bg-surface px-3 text-base tracking-widest"
                        />
                      </label>
                      <SecondaryButton disabled={code.length !== 6 || busy} onClick={() => void confirmCode()}>
                        Verify code
                      </SecondaryButton>
                    </>
                  ) : (
                    <SecondaryButton disabled={!email.includes('@') || busy} onClick={() => void sendCode()}>
                      Send code
                    </SecondaryButton>
                  )}
                </div>
              )}
            </Card>
          )}

          {error && <Notice tone="error">{error}</Notice>}
          <PrimaryButton type="submit" disabled={!canJoin}>
            {busy ? 'Joining…' : 'Join queue'}
          </PrimaryButton>
        </form>
      )}
    </Shell>
  );
}

function FieldInput({ field, value, onChange }: { field: FormField; value: unknown; onChange: (value: unknown) => void }) {
  const id = `field-${field.id}`;
  const label = (
    <>
      {field.label}
      {field.required && <span className="ml-0.5 text-red-600"> *</span>}
    </>
  );
  const inputClass = 'mt-1 h-12 w-full rounded-xl border border-border-strong bg-surface px-3 text-base';

  if (field.type === 'checkbox') {
    return (
      <label className="flex min-h-12 items-center gap-3 text-sm font-medium">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5" />
        <span>{label}</span>
      </label>
    );
  }
  if (field.type === 'dropdown') {
    return (
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        <select id={id} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">Choose…</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.type === 'radio') {
    return (
      <fieldset className="text-sm font-medium">
        <legend>{label}</legend>
        <div className="mt-1 space-y-1">
          {field.options.map((option) => (
            <label key={option} className="flex min-h-11 items-center gap-3">
              <input type="radio" name={id} checked={value === option} onChange={() => onChange(option)} className="h-5 w-5" />
              {option}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  const type = field.type === 'phone' ? 'tel' : field.type === 'number' ? 'number' : field.type;
  return (
    <label htmlFor={id} className="block text-sm font-medium">
      {label}
      <input
        id={id}
        type={type}
        inputMode={field.type === 'number' ? 'decimal' : field.type === 'phone' ? 'tel' : undefined}
        placeholder={field.placeholder ?? undefined}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(field.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)}
        className={inputClass}
      />
    </label>
  );
}

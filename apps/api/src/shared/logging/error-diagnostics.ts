type ErrorDiagnostic = {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  causes?: ErrorDiagnostic[];
};

const safeText = (value: string) =>
  value
    .replace(/\b(postgres(?:ql)?:\/\/)[^\s/@]+:[^\s/@]+@/giu, '$1[redacted]@')
    .replace(/\bBearer\s+[^\s,;]+/giu, 'Bearer [redacted]');

export function errorDiagnostics(value: unknown): ErrorDiagnostic {
  const seen = new Set<unknown>();
  function visit(error: unknown): ErrorDiagnostic {
    if (!(error instanceof Error))
      return {
        name: 'UnknownError',
        message: typeof error === 'string' ? safeText(error) : typeof error,
      };
    if (seen.has(error)) return { name: error.name, message: '[repeated error reference]' };
    seen.add(error);
    const code = (error as NodeJS.ErrnoException).code;
    const causes = [
      ...(error.cause === undefined ? [] : [error.cause]),
      ...(error instanceof AggregateError ? error.errors : []),
    ].map(visit);
    const message = safeText(
      error.message.replace(/\r?\nparams:[\s\S]*/iu, '\nparams: [redacted]'),
    );
    const stack = error.stack?.replace(error.message, message);
    return {
      name: error.name,
      message,
      stack: stack && safeText(stack),
      code: typeof code === 'string' && /^[A-Za-z0-9_]{1,80}$/u.test(code) ? code : undefined,
      causes: causes.length ? causes : undefined,
    };
  }
  return visit(value);
}

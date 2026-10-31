export type PlanPart =
  | { kind: 'bytes'; data: Uint8Array }
  | { kind: 'source'; start: number; end: number }
  | { kind: 'fill'; pattern: Uint8Array; length: number };

export interface AssemblyPlan {
  parts: PlanPart[];
  size: number;
}

export function partLength(part: PlanPart): number {
  switch (part.kind) {
    case 'bytes':
      return part.data.length;
    case 'source':
      return part.end - part.start;
    case 'fill':
      return part.length;
  }
}

export function createPlan(parts: PlanPart[]): AssemblyPlan {
  const nonEmpty = parts.filter((part) => partLength(part) > 0);

  return { parts: nonEmpty, size: nonEmpty.reduce((sum, part) => sum + partLength(part), 0) };
}

export function fillBytes(pattern: Uint8Array, length: number, phase = 0): Uint8Array {
  const output = new Uint8Array(length);

  for (let index = 0; index < length; index++) {
    output[index] = pattern[(phase + index) % pattern.length]!;
  }

  return output;
}

export function assemblePlanInMemory(plan: AssemblyPlan, sourceBytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(plan.size);
  let offset = 0;

  for (const part of plan.parts) {
    const chunk =
      part.kind === 'bytes'
        ? part.data
        : part.kind === 'source'
          ? sourceBytes.subarray(part.start, part.end)
          : fillBytes(part.pattern, part.length);

    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

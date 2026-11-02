import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Accessibility statement",
  description: "How Persona Lab itself is built and tested for accessibility, and what we know isn't perfect yet.",
};

const CHECKS: [string, string][] = [
  ["axe-core rules", "Every page, in light and dark mode, at desktop width and at 320px (the same as 400% zoom). WCAG 2.0–2.2 A and AA plus best practices."],
  ["Keyboard", "Tab through every page: the skip link comes first and works, every stop shows a focus ring, and nothing focused is hidden off screen."],
  ["Reflow", "No sideways scrolling at 320px wide (WCAG 1.4.10)."],
  ["Text spacing", "Wider letter, word, line and paragraph spacing never cuts text off (WCAG 1.4.12)."],
  ["Target size", "Every control is at least 24 × 24 pixels (WCAG 2.5.8)."],
  ["Motion", "With “reduce motion” on, nothing animates and nothing stays hidden. Anything that moves for over 5 seconds can be paused (WCAG 2.2.2)."],
  ["Form errors", "An empty submit moves focus to the field, marks it invalid and links it to the message (WCAG 3.3.1)."],
];

export default function Page() {
  return (
    <div className="wrap max-w-[52rem] pb-16">
      <h1 className="pt-14 text-[clamp(2rem,5vw,3rem)] font-bold">Accessibility statement</h1>
      <p className="mt-3 text-[1.05rem] text-ink-2">
        Persona Lab tests whether websites work for disabled people, so it has to work for them too. We aim to meet{" "}
        <strong className="text-ink">WCAG 2.2 level AA</strong>.
      </p>

      <h2 className="mt-10 text-[1.5rem] font-bold">What&apos;s built in</h2>
      <ul className="mt-3 grid list-disc gap-1.5 pl-5 text-ink-2">
        <li>A “Skip to content” link, real headings, landmarks and labelled form fields.</li>
        <li>A visible focus ring on everything you can reach with the keyboard.</li>
        <li>Light and dark themes that follow your system setting, both checked for contrast.</li>
        <li>Animations stop when your device asks for reduced motion, and the scrolling banner has a pause button.</li>
        <li>Results never rely on color alone: every pass or fail also has a ✓ or ✕ and words.</li>
      </ul>

      <h2 className="mt-10 text-[1.5rem] font-bold">How it&apos;s checked</h2>
      <p className="mt-2 text-ink-2">
        Automated tools only catch part of the problems, so the test suite (<code>tests/test_a11y.py</code>) runs these checks in a real browser on every change:
      </p>
      <dl className="mt-4 grid gap-2.5">
        {CHECKS.map(([k, v]) => (
          <div key={k} className="card grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
            <dt className="font-bold">{k}</dt>
            <dd className="text-sm text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-10 text-[1.5rem] font-bold">Known limitations</h2>
      <ul className="mt-3 grid list-disc gap-1.5 pl-5 text-ink-2">
        <li>It hasn&apos;t yet been tested by disabled people or with every screen reader (NVDA, JAWS, VoiceOver, TalkBack). Until then we say we <em>aim</em> to conform, not that we do.</li>
        <li>Test results show screenshots of other people&apos;s websites. The text next to each one describes what the agent found, but the screenshot itself can&apos;t be fully described.</li>
        <li>Agent summaries are written by an AI model and can be wrong. The evaluation page shows how often.</li>
        <li>“See it like them” is a rough simulation to build empathy, not a replacement for testing with real people.</li>
      </ul>

      <h2 className="mt-10 text-[1.5rem] font-bold">Tell us about a problem</h2>
      <p className="mt-2 text-ink-2">
        If something doesn&apos;t work for you, please{" "}
        <a href="https://github.com/gobika21/persona-lab/issues/new" target="_blank" rel="noopener" className="font-semibold text-ink underline">
          open an issue on GitHub<span className="sr-only"> (opens in a new tab)</span>
        </a>{" "}
        and describe what you were trying to do and what you use (browser, screen reader, zoom level). Accessibility problems are fixed first.
      </p>
      <p className="mt-6 text-sm text-ink-3">Last reviewed: November 2, 2026.</p>
    </div>
  );
}

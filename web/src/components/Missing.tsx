import Link from "next/link";
import { REPO_URL, SHOWCASE } from "@/lib/api";

export default function Missing({ message, title = "Test not found" }: { message: string; title?: string }) {
  return (
    <div className="wrap py-14">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-ink-2">{message}</p>
      {SHOWCASE ? (
        <p className="mt-4 flex gap-2"><Link className="btn" href="/replay">Watch a real run</Link><a className="btn" href={REPO_URL}>Run it yourself<span className="sr-only"> (GitHub)</span></a></p>
      ) : (
        <p className="mt-4 flex gap-2"><Link className="btn" href="/">New test</Link><Link className="btn" href="/history">History</Link></p>
      )}
    </div>
  );
}

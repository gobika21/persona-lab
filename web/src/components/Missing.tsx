import Link from "next/link";

export default function Missing({ message }: { message: string }) {
  return (
    <div className="wrap py-14">
      <h1 className="text-2xl font-semibold">Test not found</h1>
      <p className="mt-2 text-ink-2">{message}</p>
      <p className="mt-4 flex gap-2"><Link className="btn" href="/">New test</Link><Link className="btn" href="/history">History</Link></p>
    </div>
  );
}

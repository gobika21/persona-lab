import type { Metadata } from "next";
import ReplayClient from "./ReplayClient";

export const metadata: Metadata = { title: "Watch a real run" };

export default function Page() {
  return <ReplayClient />;
}

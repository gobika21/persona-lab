import type { Metadata } from "next";
import RunClient from "./RunClient";

export const metadata: Metadata = { title: "Test results" };

export default function Page() {
  return <RunClient />;
}

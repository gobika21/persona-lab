import type { Metadata } from "next";
import CompareClient from "./CompareClient";

export const metadata: Metadata = { title: "Before and after" };

export default function Page() {
  return <CompareClient />;
}

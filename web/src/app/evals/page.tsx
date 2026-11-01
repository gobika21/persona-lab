import type { Metadata } from "next";
import EvalsClient from "./EvalsClient";

export const metadata: Metadata = { title: "Evals", description: "How well the persona agents find planted accessibility barriers." };

export default function Page() {
  return <EvalsClient />;
}

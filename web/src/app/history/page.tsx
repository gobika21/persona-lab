import type { Metadata } from "next";
import HistoryClient from "./HistoryClient";

export const metadata: Metadata = { title: "History", description: "Your saved accessibility tests, kept in this browser." };

export default function Page() {
  return <HistoryClient />;
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useClobNetwork } from "~~/hooks/clob/useClobNetwork";
import { JournalEntry, consensusToDate, getJournalTopicId, listIntents } from "~~/lib/journal";
import { hashscan } from "~~/lib/mirror/client";

const Row = ({ entry }: { entry: JournalEntry }) => {
  const { config } = useClobNetwork();
  const links = hashscan(config);
  const { intent } = entry;

  return (
    <tr className="hover">
      <td className="whitespace-nowrap font-mono text-xs">
        {consensusToDate(entry.consensusTimestamp).toLocaleString()}
        <span className="ml-2 opacity-50">#{entry.sequenceNumber}</span>
      </td>
      <td>
        <span className="badge badge-sm badge-outline">{intent.action}</span>
        {intent.dryRun && (
          <span className="badge badge-sm badge-ghost ml-1" title="Signed to demonstrate the flow; never submitted">
            dry run
          </span>
        )}
      </td>
      <td className="font-mono text-xs">
        {intent.market?.pair ?? "—"} <span className="opacity-50">#{intent.orderbookId}</span>
      </td>
      <td className={`font-mono text-xs ${intent.side === "BUY" ? "text-success" : "text-error"}`}>
        {intent.side ?? "—"}
      </td>
      <td className="text-right font-mono text-xs">{intent.price ?? "—"}</td>
      <td className="text-right font-mono text-xs">{intent.size ?? "—"}</td>
      <td className="font-mono text-xs">
        {intent.eip712Hash ? (
          <span title={intent.eip712Hash}>{intent.eip712Hash.slice(0, 10)}…</span>
        ) : (
          <span className="opacity-40">—</span>
        )}
      </td>
      <td className="text-right text-xs">
        <a className="link" href={links.topic(entry.topicId)} target="_blank" rel="noreferrer">
          on HashScan
        </a>
      </td>
    </tr>
  );
};

const JournalPage = () => {
  const { config, network } = useClobNetwork();
  const { address } = useAccount();
  const topicId = getJournalTopicId();

  const { data: entries, isLoading } = useQuery({
    queryKey: ["journal", network, topicId, address],
    enabled: Boolean(topicId),
    queryFn: ({ signal }) => listIntents(config, { topicId, signal }),
    refetchInterval: 10_000,
  });

  const links = hashscan(config);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold">Order intent journal</h1>
      <p className="mt-1 max-w-3xl text-sm opacity-70">
        Every order this app signs is written to a Hedera Consensus Service topic <em>before</em> it reaches SaucerSwap.
        The result is your own consensus-timestamped record of exactly what you signed, ordered by the network rather
        than by the venue — and it is what each fill is later checked against.
      </p>

      {!topicId && (
        <div className="alert alert-info mt-6">
          <div>
            <p className="font-medium">No journal topic configured yet.</p>
            <p className="text-sm opacity-80">
              Run <code className="font-mono">yarn clob:bootstrap</code>, then set{" "}
              <code className="font-mono">NEXT_PUBLIC_JOURNAL_TOPIC_ID</code> in{" "}
              <code className="font-mono">packages/nextjs/.env</code>.
            </p>
          </div>
        </div>
      )}

      {topicId && (
        <p className="mt-2 text-xs opacity-60">
          Topic{" "}
          <a className="link font-mono" href={links.topic(topicId)} target="_blank" rel="noreferrer">
            {topicId}
          </a>{" "}
          on {network}. The topic is public: anyone can read this without the app.
        </p>
      )}

      {isLoading && <p className="mt-8 text-center opacity-60">Reading the topic…</p>}

      {entries && entries.length === 0 && (
        <p className="mt-8 rounded-box bg-base-200 p-8 text-center text-sm opacity-70">
          No intents recorded yet. Sign one from a market page to see it appear here.
        </p>
      )}

      {entries && entries.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-box bg-base-100">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Consensus time</th>
                <th>Action</th>
                <th>Market</th>
                <th>Side</th>
                <th className="text-right">Price</th>
                <th className="text-right">Size</th>
                <th>EIP-712 hash</th>
                <th className="text-right">Link</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <Row key={`${entry.topicId}-${entry.sequenceNumber}`} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 max-w-3xl text-xs opacity-60">
        What this proves: what was signed, and when. What it does not prove: that the venue matched your order fairly.
        Matching happens off-chain at SaucerSwap. The journal is the record you keep of your own side.
      </p>
    </div>
  );
};

export default JournalPage;

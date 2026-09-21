import Image from "next/image";
import Link from "next/link";
import type { NextPage } from "next";
import { ArrowRightIcon, BugAntIcon, ChartBarIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";

const Home: NextPage = () => {
  return (
    <>
      <div className="flex items-center flex-col grow">
        <div className="hedera-gradient dark:bg-none dark:bg-hedera-charcoal w-full py-16 px-5">
          <div className="flex flex-col items-center max-w-3xl mx-auto text-center">
            <Image
              src="/Hedera-Icon-White.svg"
              alt="Hedera icon"
              width={64}
              height={64}
              className="mb-4 hidden dark:block"
            />
            <Image src="/Hedera-Icon-Dark.svg" alt="Hedera icon" width={64} height={64} className="mb-4 dark:hidden" />
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">limit-orders</h1>
            <p className="text-xl text-white/80 dark:text-white/60 max-w-2xl">
              Add non-custodial limit orders from SaucerSwap&apos;s order book to any Hedera app, with every fill
              verified on-chain against what you signed.
            </p>
            <Link href="/markets" className="btn btn-neutral mt-8">
              Open the markets
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <p className="text-sm text-white/70 dark:text-white/50 mt-4">
              Market data needs no wallet, no API key and no deployed contract.
            </p>
          </div>
        </div>

        <div className="grow bg-base-300 w-full px-8 py-12">
          <div className="flex justify-center items-stretch gap-8 flex-col md:flex-row max-w-5xl mx-auto">
            <div className="flex flex-col bg-base-100 px-8 py-8 text-center items-center rounded-3xl flex-1">
              <ChartBarIcon className="h-8 w-8 fill-secondary" />
              <p>
                Live markets at{" "}
                <Link href="/markets" passHref className="link">
                  /markets
                </Link>
                : depth, spread, the trade tape, and each market&apos;s tick, lot and minimum notional.
              </p>
            </div>
            <div className="flex flex-col bg-base-100 px-8 py-8 text-center items-center rounded-3xl flex-1">
              <ShieldCheckIcon className="h-8 w-8 fill-secondary" />
              <p>
                Onboarding, signing and cancellation happen through your own wallet. Funds stay with you until a fill
                settles on Hedera.
              </p>
            </div>
            <div className="flex flex-col bg-base-100 px-8 py-8 text-center items-center rounded-3xl flex-1">
              <BugAntIcon className="h-8 w-8 fill-secondary" />
              <p>
                Inspect contracts at{" "}
                <Link href="/debug" passHref className="link">
                  /debug
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Home;

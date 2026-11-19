/**
 * Every string on the attendee screens. English lives here; Hindi lives in i18n-hi.ts and is
 * loaded only when someone picks it, which keeps the door route's JavaScript small. The Hindi is the everyday Hindi a
 * college student speaks: common English words for tech things (QR कोड, वॉलेट, स्टैम्प) written in
 * Devanagari, not formal Sanskritised Hindi.
 *
 * Copy rules (docs/INTERFACES.md section 7) apply to both languages: plain words, sentence case,
 * no dashes as punctuation, no emoji, no exclamation marks, and every error says what happened and
 * what to do next.
 */

export type Locale = "en" | "hi";

export const LOCALES: readonly Locale[] = ["en", "hi"];

const english = {
  lang: {
    /** The toggle shows the language you would switch to, written in that language. */
    switchTo: "हिन्दी",
    switchLabel: "Switch the language to Hindi",
  },
  nav: {
    passport: "Passport",
    scan: "Scan",
    attendee: "Attendee",
  },
  common: {
    retry: "Try again",
    retryNow: "Try now",
    backToPassport: "Back to passport",
    loading: "Loading",
    explorer: "View on the QIE explorer",
    eventFallback: (id: string) => `Event ${id}`,
    stampCount: (n: number) => (n === 1 ? "1 stamp" : `${n} stamps`),
  },
  checkIn: {
    metaTitle: "Check in",
    eyebrow: "Checking in to",
    eyebrowDone: "Checked in to",
    signing: "Checking you in",
    sending: "Checking you in",
    sendingHint: "Sending your signed check-in to Showmark.",
    confirming: "Recording your stamp on QIE",
    confirmingHint: "This usually takes about 4 seconds.",
    stamped: "You are checked in",
    stampedHint: "Your stamp is recorded on the QIE network and lives in your passport.",
    already: "You were already checked in",
    alreadyHint: "You get one stamp per event, and this one is already in your passport.",
    waitingTitle: "Your check-in is saved on this phone",
    checkInButton: "Check in",
    checkedInAt: (time: string) => `Checked in at ${time}`,
    openPassport: "Open my passport",
    noWalletNeeded:
      "No wallet or sign-up needed. This phone keeps a private pass that signs your check-in, and Showmark pays the network fee.",
    pendingStampLabel: (event: string) => `Your stamp for ${event}, waiting for the network`,
    rewardsTitle: "Rewards for being here",
    rewardLine: (sponsor: string) => `${sponsor} pays each verified guest`,
    rewardNeedsQieId: "Paid once you link QIE Wallet that holds a QIE ID.",
    rewardDoorScan: "Paid only when a door volunteer scans your code.",
    noRewards: "No sponsor is paying for this event right now. You still get the stamp.",
    eventLoadFailed: "The event details did not load, but your check-in carries on.",
    linkPromptTitle: "Keep your stamps and rewards in QIE Wallet",
    linkWhy:
      "Linking moves your stamps into QIE Wallet, lets you withdraw rewards, and lets you join campaigns that need a QIE ID.",
    linkNow: "Link QIE Wallet",
    notNow: "Not now",
    opensAt: (time: string) => `Check-in for this event opens at ${time}.`,
    scanAgain: "Scan the door code",
    receiptLabel: "Check-in receipt",
    receiptEvent: "Event",
    receiptTime: "Time",
    receiptTx: "Transaction",
    receiptPending: "Waiting for the block",
    receiptNotSent: "Not sent yet",
    receiptEarlier: "Recorded earlier",
  },
  errors: {
    invalidCode: {
      message: "This link is not a Showmark door code.",
      action: "Scan the QR code on the door screen again with your camera.",
    },
    storage: {
      message: "This browser does not let Showmark save a pass.",
      action: "Open this page in your normal browser, not a private window.",
    },
    offline: {
      message: "Your phone is offline.",
      action: "It goes through on its own as soon as you are back online. Keep this screen open.",
    },
    relay: {
      message: "Showmark could not reach the network just now.",
      action: "Showmark tries again on its own, or you can try now.",
    },
    retryIn: (seconds: number) => (seconds <= 1 ? "Trying again now." : `Trying again in ${seconds} seconds.`),
    confirmTimeout: {
      message: "The network is taking longer than usual to confirm your check-in.",
      action: "It was sent. Check your passport in a minute, or open the transaction on the explorer.",
    },
    reverted: {
      message: "The network did not record this check-in.",
      action: "Scan the door code again.",
    },
    unknown: {
      message: "Something went wrong with this check-in.",
      action: "Scan the door code again. If it keeps happening, tell the organizer.",
    },
  },
  scan: {
    metaTitle: "Scan a door code",
    title: "Scan the door code",
    instructions: "Point your camera at the QR code on the door screen. Your check-in starts as soon as it reads the code.",
    tip: "Hold the phone about an arm's length from the screen and keep the whole code inside the frame.",
    startCamera: "Turn on camera",
    starting: "Starting the camera",
    torchOn: "Turn on the light",
    torchOff: "Turn off the light",
    viewfinderLabel: "Camera view. Point it at the door code.",
    found: "Door code found. Opening your check-in.",
    cameraDenied: {
      message: "Showmark is not allowed to use your camera.",
      action: "Allow camera access for this site in your browser settings, then try again. You can also scan the door code with your phone's camera app.",
    },
    noCamera: {
      message: "This device has no camera Showmark can use.",
      action: "Scan the door code with your phone's camera app instead.",
    },
    cameraBusy: {
      message: "Another app is using the camera.",
      action: "Close the other app or tab that is using the camera, then try again.",
    },
    cameraFailed: {
      message: "The camera did not start.",
      action: "Try again. If it still does not start, scan the door code with your phone's camera app.",
    },
    notShowmark: {
      message: "This QR code is not a Showmark door code.",
      action: "Point the camera at the code on the door screen.",
    },
    attendeeCode: {
      message: "This is an attendee code, which the door volunteer scans.",
      action: "To check yourself in, scan the code on the door screen.",
    },
  },
  pass: {
    metaTitle: "Your passport",
    title: "Your passport",
    subtitle: "Every stamp from this phone's pass, recorded on the QIE network.",
    passLabel: "Pass on this phone",
    walletLabel: "Linked wallet",
    notLinked: "Not linked yet",
    guillocheLabel: "A pattern drawn from your pass address, so no other passport looks like this one",
    stampsTitle: "Stamps",
    emptyTitle: "No stamps yet",
    emptyBody: "Scan the QR code at the door of a Showmark event and your first stamp lands here.",
    scanCta: "Scan a door code",
    localStampNote: "Recorded on QIE. It shows in the public index within a minute.",
    streaksTitle: "Streaks",
    streakLine: (current: number, best: number) => `${current} in a row, best ${best}`,
    rewardsTitle: "Rewards you can withdraw",
    noRewards: "Nothing to withdraw yet. Rewards show up here after a sponsor pays for an event you attended.",
    withdrawCta: "Withdraw",
    linkToWithdraw: "Link QIE Wallet to withdraw",
    pendingTitle: "Payouts on the way",
    pendingFor: (event: string) => `For ${event}`,
    pendingNeedsQieId: (date: string | null) =>
      date ? `Link a wallet that holds a QIE ID before ${date} to receive this.` : "Link a wallet that holds a QIE ID to receive this.",
    pendingPriceStale: "Waiting for the QIE price feed to update. You do not need to do anything.",
    pendingPending: "Being paid out. This usually takes a few seconds.",
    codeTitle: "Your code for the door",
    codeBody: "Some events ask a door volunteer to scan you instead. Pick the event and show this code.",
    codeEventLabel: "Event",
    codeRecent: "Opened on this phone",
    codeUpcoming: "Upcoming",
    codeNoEvents: "No upcoming events were found. Open a door code once and that event shows up here.",
    codeQrLabel: (event: string) => `Your attendee code for ${event}. Show it to the door volunteer.`,
    codeCaption: "Show this to the door volunteer",
    codeStatus: "Turn your screen brightness up if the scan is slow.",
    fullscreen: "Show full screen",
    closeFullscreen: "Close",
    loadFailed: {
      message: "Your passport did not load.",
      action: "Check your connection and try again. Your stamps are safe on the QIE network.",
    },
    outboxTitle: "A check-in is waiting to be sent",
    outboxBody: (event: string) => `Your check-in for ${event} is saved on this phone and has not reached the network yet.`,
    outboxSend: "Send it now",
    noPassNote: "This phone has no pass yet. It makes one the first time you check in.",
  },
  link: {
    metaTitle: "Link QIE Wallet",
    title: "Link QIE Wallet",
    step1: "Connect your wallet",
    step2: "Sign the link",
    connect: "Connect QIE Wallet",
    connecting: "Waiting for QIE Wallet",
    connectedAs: "Connected wallet",
    signExplain: "QIE Wallet asks you to sign a message that links it to this pass. It does not move any funds or cost anything.",
    moveStamps: (n: number) => (n === 1 ? "Move my stamp into this wallet" : `Move my ${n} stamps into this wallet`),
    sign: "Link this wallet",
    signing: "Sign in QIE Wallet",
    submitting: "Recording the link on QIE",
    linkedTitle: "QIE Wallet is linked",
    linkedBody: "Your stamps live in this wallet now, and rewards go to it when you withdraw.",
    alreadyLinked: "This pass is already linked to a wallet.",
    switchNetwork: "Switch network",
    getWallet: "Get QIE Wallet",
    phoneHint: "On a phone, open this page in a browser where QIE Wallet is installed, so the wallet and this pass are on the same device.",
    walletTaken: {
      message: "This wallet is already linked to another pass.",
      action: "Each wallet links to one pass. Connect a different wallet, or open Showmark on the phone that holds the other pass.",
    },
    noPass: {
      message: "There is no pass on this phone yet.",
      action: "Check in at an event first, then link your wallet.",
    },
    checkFailed: {
      message: "Showmark could not check this wallet just now.",
      action: "Check your connection and try again.",
    },
    reverted: {
      message: "The network did not record the link.",
      action: "Try again. Each pass links to one wallet, and each wallet to one pass.",
    },
    slow: {
      message: "The network is taking longer than usual to record the link.",
      action: "It was sent. Open your passport in a minute to see the linked wallet.",
    },
  },
  withdraw: {
    metaTitle: "Withdraw rewards",
    title: "Withdraw rewards",
    body: "Rewards go to the wallet you linked. Showmark pays the network fee.",
    sendsTo: "Sends to",
    submit: (symbol: string) => `Withdraw ${symbol}`,
    sending: "Sending",
    confirming: "Recording the withdrawal on QIE",
    done: "Withdrawn to your wallet",
    nothing: "Nothing to withdraw right now. Rewards show up after a sponsor pays for an event you attended.",
    needsLink: {
      message: "Link QIE Wallet before you withdraw.",
      action: "Rewards can only go to a wallet you linked to this pass.",
    },
    failed: {
      message: "The withdrawal did not go through.",
      action: "Try again in a minute. Your rewards stay safe in the vault until they reach your wallet.",
    },
    slow: {
      message: "The network is taking longer than usual to record the withdrawal.",
      action: "It was sent. Check your wallet in a minute, or open the transaction on the explorer.",
    },
  },
} as const;

type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : { readonly [K in keyof T]: Widen<T[K]> };

export type Dictionary = Widen<typeof english>;

export interface Copy {
  message: string;
  action: string;
}

/** Translated copy for API error codes (src/server/errors.ts) and wallet store codes, keyed by code. */
export type ErrorTable = Readonly<Record<string, Copy>>;

export interface ErrorTables {
  api: ErrorTable;
  wallet: ErrorTable;
}

export const en: Dictionary = english;

/**
 * Picks the words for an API or wallet error. In English (`table` null) the app shows the API's own
 * message and action, which are already written to the copy rules; in Hindi it shows the
 * translation, and falls back to the API's English for a code it does not know.
 */
export function localizedError(code: string, english: Copy, table: ErrorTable | null): Copy {
  return table?.[code] ?? english;
}

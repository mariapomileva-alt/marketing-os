import type { GuardrailRule } from "../guardrails";

/**
 * "Back — voice, phrases and rules", version of 26 October 2026, approved by the owner.
 * Applied to the Back product from Product & rules with one click (idempotent: nothing is added twice).
 * Pricing changes planned for Back Plus are NOT facts until they are live in the app, so they are not here.
 */
export const BACK_RULES_PACK = {
  id: "back-voice-2026-10-26",
  title: "Back voice, phrases and rules (26 Oct 2026)",
  profile: {
    short_description: "A panic attack app that asks nothing of you: one tap, no account, works offline. Support for the first minutes of panic, acute anxiety, fear and sensory overwhelm.",
    website_url: "https://backapp.live",
    countries: ["US", "GB"],
    pain_points: [
      "Panic at night, when there is nobody to call",
      "Panic on the metro, on a plane or in a meeting, while trying to look normal",
      "Apps that want an account, a quiz or a 20-minute lesson when you can barely think",
      "Breathing exercises that feel like pressure",
      "Sensory overload: noise, light, crowds",
      "Fear of the next attack",
      "Loved ones who don't know how to help",
    ],
    triggers: [
      "A panic attack at night",
      "A first panic attack",
      "Panic on public transport or in a crowded place",
      "Before a flight, an exam, an interview or a doctor's visit",
      "Sensory overload in loud or bright places",
      "Someone close has panic attacks and wants to help",
    ],
    desired_emotional_states: ["Steadier in the next minute", "Less alone", "Back in the room", "In charge of the next small choice"],
    advantages: [
      "Nothing to set up: no account, no questionnaire, no lessons. Open it and help starts.",
      "Works offline: on the metro, on a plane, at night.",
      "Collects nothing: the App Store label says Data Not Collected.",
      "Doesn't force 'correct' breathing: if breathing feels bad, pick another tool.",
      "Call my person is always one tap away and free.",
    ],
    prohibited_topics: ["Diagnosis of any condition", "Medication advice", "Comparisons that shame other forms of help", "Competitor names in App Store metadata"],
    legal_restrictions:
      "Back is a self-help tool. It is not therapy, a diagnosis, an emergency service, or a medical device. It does not cure panic attacks and does not replace a doctor, therapist or emergency service.",
    tone_of_voice: `Calm, human, warm, specific. Short sentences, simple words, "you", present tense.
The reader may be vulnerable right now: no hype, no pressure, no exclamation chains.
Concrete instead of general: "put both feet on the floor", not "try to calm down".
Gentle invitations instead of orders: "if you like", "you can", "it's fine to stop".
Describe what a person can do right now; never promise a result.
Naming: in texts say "Back panic app" or "Back: Panic Attack Help", never just "Back" without context. "You're here." is the brand line, always after a plain description.
Comments and replies: a real person from a small team, 1–3 sentences, varied shapes, most end on a statement, never "Does anyone else…?". The product only when asked or genuinely helpful, always saying we are the team.`,
    good_examples: [
      { text: "You're here. What feels possible right now?", why: "Calm, present, an invitation" },
      { text: "You don't have to fix the whole night. The next small choice is enough.", why: "Specific, no promise" },
      { text: "If breathing feels uncomfortable, you can leave it. A different route is allowed.", why: "Gives permission, no breathing orders" },
      { text: "Honestly the tip to name five colours around you is so underrated. It's small enough to actually remember when your brain is loud.", why: "Comment: specific, ends on a statement" },
    ],
    bad_examples: [
      { text: "Stop panic attacks in 60 seconds! Download now before it gets worse!", why: "Cure promise, urgency, fear, sales" },
      { text: "Great video! Panic attacks are really tough. It's important to remember you are not alone on this journey. Check out our app Back!", why: "Bot phrases and a pitch" },
    ],
  },
  facts: [
    "Back needs no account, no questionnaire and no lessons: open it and help starts.",
    "Back works offline.",
    "Back's App Store privacy label is Data Not Collected; nothing you save in Back is sent to Back.",
    "Back has six tools: Breathe, Distract, Ground, Move, Listen and Read, plus Extra support and Call my person.",
    "In Back, if breathing feels uncomfortable, you can choose a different tool.",
    "Call my person is always one tap away and free; Extra support and Call my person are never behind a subscription.",
    "Back is a self-help tool. It is not therapy, a diagnosis, an emergency service, or a medical device.",
    "Back does not diagnose and is not a replacement for a doctor or therapist.",
    "Back's website is backapp.live.",
  ],
  prohibited: [
    "Back stops, prevents or ends panic attacks.",
    "Back is clinically proven, tested by doctors or recommended by doctors.",
    "Any statistics, study results, ratings or user numbers about Back.",
    "Stories or testimonials of users, or the team's own experience of panic being helped by Back.",
    "Any advice about medication: starting, stopping or changing it.",
    "Back is better than therapy or other forms of help.",
  ],
  links: [
    { kind: "website" as const, label: "Website", url: "https://backapp.live", cta_text: "Open Back" },
    { kind: "app_store" as const, label: "App Store", url: "https://apps.apple.com/app/id6811918141", cta_text: null },
  ],
  crisisLine: "In danger right now? Call your local emergency number — 112 in the EU, 911 in the US, 999 in the UK.",
};

export const BACK_RULES_PACK_GUARDRAILS: GuardrailRule[] = [
  {
    code: "backapp.no_medication_advice",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "Never give advice about medication.",
    patterns: [
      "\\b(take|stop taking|start taking|increase|reduce|lower|skip|quit|come off) (your |the |a )?(meds|medication|medicine|pills?|xanax|benzos?|benzodiazepines?|ssris?|sertraline|propranolol|beta[- ]blockers?|antidepressants?)\\b",
      "(прими|примите|бросьте|бросить|отмени(те)?|перестань(те)? принимать|снизь(те)? дозу) [\\p{L} ]{0,12}(лекарств|таблет|антидепрессант|транквилизатор)",
    ],
  },
  {
    code: "backapp.no_invented_proof",
    ruleType: "forbidden_phrase",
    severity: "warn",
    rationale: "No invented proof: no 'clinically proven', no 'doctors recommend', no statistics we do not have.",
    patterns: ["\\bclinically (proven|tested|validated)\\b", "\\bdoctors? (recommend|approved)\\b", "\\b(studies|research) (shows?|proves?)\\b", "клинически (доказан|проверен)", "(рекомендуют|одобрено) врач", "исследования (показали|доказали)"],
  },
  {
    code: "backapp.no_bot_phrases",
    ruleType: "forbidden_phrase",
    severity: "warn",
    rationale: "Sounds like a bot. Say it the way a person would.",
    patterns: [
      "\\bgreat (video|point|post)\\b", "^\\s*thank you for sharing\\b", "\\bI appreciate\\b", "\\bresonates?\\b", "\\bit'?s important to remember\\b",
      "\\bjourney\\b", "\\bvaluable insights?\\b", "\\bdelve\\b", "\\bin today'?s world\\b", "\\bas someone who\\b", "\\bgame[- ]changer\\b",
    ],
  },
  {
    code: "backapp.no_sales_words",
    ruleType: "forbidden_phrase",
    severity: "warn",
    rationale: "Sales words read as pressure: no 'download now', 'best app', 'check out', 'link in bio'.",
    patterns: ["\\bdownload (it |back |the app )?now\\b", "\\bbest app\\b", "\\bcheck out (our|the|this) app\\b", "\\blink in (the )?bio\\b"],
  },
  {
    code: "backapp.relief_keywords_only",
    ruleType: "forbidden_phrase",
    severity: "warn",
    rationale: "'Relief' is used only in hidden App Store keywords, not in visible texts (it reads as a medical promise).",
    patterns: ["\\brelief\\b"],
  },
  {
    code: "backapp.no_ai_reveal",
    ruleType: "forbidden_phrase",
    severity: "warn",
    rationale: "'It's not X, it's Y' turns read as AI-written. Say the point directly.",
    patterns: ["\\b(it|this|that)(?: is|'s| isn'?t)( not)? (just |really |about |only )*[^.?!\\n]{2,40}(,|;|—|–) ?(it'?s|it is)\\b", "\\bdoes anyone else\\b[^?]*\\?\\s*$"],
  },
];

/** The same rules as one knowledge document, so every draft can find them by topic. */
export const BACK_RULES_DOC = `# Back — voice, phrases and rules (26 Oct 2026)

One document for everyone who writes as Back: website, App Store, social posts, comments, articles, and the AI in God of Marketing.
If a phrase or rule changes, update this document first, then God of Marketing.

## What Back is
One line: Back — a panic attack app that asks nothing of you: one tap, no account, works offline.
Support in the moment of panic, acute anxiety, fear and sensory overwhelm. Six simple tools: Breathe, Distract, Ground, Move, Listen, Read. Plus Extra support and Call my person.
Back is not therapy, not a diagnosis, not a medical device and not an emergency service.

Who it is for: an adult with panic attacks or strong anxiety who has no capacity, mid-attack, for lessons, accounts or 20-minute meditations; people with sensory overload; their loved ones looking for ways to help.

What makes Back different (true, usable anywhere):
- Nothing to set up: no account, no questionnaire, no lessons. Open it and help is already there.
- Works offline: on the metro, on a plane, at night.
- Collects nothing: the App Store label says Data Not Collected.
- Doesn't force "correct" breathing: if breathing feels bad, pick another tool.
- Call my person is always one tap away and free.

## Naming
- App Store name: Back: Panic Attack Help
- Texts, articles, profiles, lists: Back panic app, or Back: Panic Attack Help
- Inside the app and on the icon: Back
- Brand line: You're here.
Never write just "Back" without context: the word is too common for a person or an AI to find the app by it. "You're here." always comes after a plain description.

## Voice
- Calm, human, warm, specific.
- Short sentences. Simple words. "You", present tense.
- The reader may be vulnerable right now. No hype, no pressure, no exclamation chains.
- Concrete instead of general: "put both feet on the floor", not "try to calm down".
- Gentle invitations instead of orders: "if you like", "you can", "it's fine to stop".
- Don't promise a result; describe what the person can do right now.

How we sound:
> You're here. What feels possible right now?
> You don't have to fix the whole night. The next small choice is enough.
> If breathing feels uncomfortable, you can leave it. A different route is allowed.

How we never sound:
> Stop panic attacks in 60 seconds! Download now before it gets worse!

## Approved phrases
- Website H1: Help for the first minute of a panic attack.
- Website subtitle: Six gentle tools that start in one tap. No account, no lessons, works offline.
- Under the button: Free · Nothing you do leaves your phone
- Website title: Back — Panic Attack Help App (Free, Offline, No Account)
- App Store subtitle: Anxiety SOS & calm breathing
- App Store promotional text: Panic at night or on the metro? Back opens in one tap, needs no account and works offline.
- Screenshots: Help in the first minute of panic / Breathe gently. Or pick another way / No account. Works offline. Nothing leaves your phone / Rain, ocean, brown noise for night panic / Ground yourself in the room you are in / Your person, one tap away / Calm games with no scores
- End of articles: Back works offline and needs no account. Open it when the next minute feels hard.
- Tell your person: I added you as my person in Back, a small app I use when panic rises. If I call, you don't have to fix anything. This explains what helps: [link]
- Lock Screen card: Add Back to your Lock Screen, so next time it is one tap away
- YouTube Shorts: A minute of calm for when panic rises. From the team behind Back.

## What we may claim
- Back provides in-the-moment support during panic, acute anxiety, fear and sensory overwhelm.
- Back is not medical treatment.
- No account. Works offline. Nothing you save is sent to Back.
- Extra support and Call my person are never behind a subscription.
Anything else about the product is checked against the app and the website first. Never invent numbers, studies or effectiveness.

## Never
- Promise a cure (cure, heal your anxiety, stop panic attacks forever, never have a panic attack again). Allowed: Back is not a cure.
- Diagnose (you have panic disorder). Allowed: Back does not diagnose.
- Replace professionals (instead of therapy, you don't need a therapist). Allowed: Back is not a replacement for a doctor or therapist.
- False urgency (only today, last chance, act now, hurry). Allowed: There is no hurry.
- Fear (before it's too late, it will only get worse).
- Guarantees (guaranteed, 100%).
- Aggressive sales (buy now, don't miss out, discount).
- Medication advice; shaming other kinds of help; invented reviews, user stories, "tested by doctors", statistics; writing as a customer or as if the team had panic and Back helped.
- Competitor names (Calm, Headspace, Rootd, Dare) in App Store metadata; an honest comparison only on the website.
- "Relief" in visible texts: only in hidden App Store keywords.

## Safety
If a text mentions suicide, self-harm or an emergency, it must include an emergency line. Ours:
> In danger right now? Call your local emergency number — 112 in the EU, 911 in the US, 999 in the UK.
Standard disclaimer:
> Back is a self-help tool. It is not therapy, a diagnosis, an emergency service, or a medical device.
If someone in the comments writes about a crisis, we do not mention the product. We answer briefly and gently with the emergency line and hand the conversation to a person on the team.

## Comments and replies
We write as a real person from a small team, from the team's account. Warm, kind, a little informal, curious about people.
- Short: 1–3 sentences, 15–60 words. Vary the length.
- Simple words, contractions (it's, you're).
- Specific: pick up a few words from the video or the comment we answer.
- A different shape every time. Most comments end on a statement; at most one in three ends with a question, and never "Does anyone else…?", "Has anyone here…?" or "Did anyone else…?".
- Don't open by quoting the creator and calling it "such a gentle way to put it", and don't open with "I'm glad you…".
- The product only if the person asked or it truly helps; then say we are on the Back team.
- We are not customers and never tell "our own experience" of panic.
- Only English videos about anxiety and panic, preferably recent.
Banned words and habits: "Great video", "Great point", "Thank you for sharing" as an opener, "I appreciate", "resonates", "It's important to remember", "journey", "valuable insights", "Absolutely!", "delve", "in today's world", "As someone who…"; hashtags, more than one exclamation mark or emoji, dashes everywhere, lists, sign-offs like "Best, the team". Sales words: download, best app, check out, link in bio.
AI tells, never: "it's not X, it's Y" reveals; "Not the X. The Y." corrections; "no X, no Y, no Z" chains; tidy triplets; sentences trailing into an extra comma clause.

Good (tone only, never copy):
> Honestly the tip to name five colours around you is so underrated. It's small enough to actually remember when your brain is loud.
> Yes, the 'what if it happens on the train' fear is often worse than the train itself. I'm on the team that makes Back, and we keep running into that same pattern.
Bad:
> Great video! Panic attacks are really tough. It's important to remember you are not alone on this journey. Check out our app Back!

## Our own Threads posts
- Two a day, approved by a person, posted at 09:30 and 19:30 Riga time.
- First line is the hook, under 80 characters. 120–400 characters. Short lines, white space.
- No hashtags, at most one emoji. Links only in article and product posts, one link at the end.
- Product posts at most one in five. Only question posts end with a question.
- Same safety rules and AI-tell rules as comments.
`;

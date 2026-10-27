export const metadata = { title: "Privacy — Back Publisher" };

export default function PrivacyPage() {
  return (
    <>
      <h1>Back Publisher — Privacy Policy</h1>
      <p className="text-muted">Last updated: 27 October 2026</p>
      <p>
        Back Publisher is the internal publishing tool of the team behind Back, a self-help app for the first minutes of a
        panic attack (backapp.live). Only members of the Back team sign in to it. It is used to publish the team&apos;s own
        videos to the team&apos;s own TikTok, YouTube, Threads and Instagram accounts after a team member approves each one.
      </p>
      <h2>What we receive from TikTok</h2>
      <ul>
        <li>For the team&apos;s own TikTok account only: the account&apos;s open id, display name and avatar (user.info.basic).</li>
        <li>Access and refresh tokens that let the tool upload or post the team&apos;s videos (video.upload, video.publish).</li>
        <li>Status and basic statistics of the videos the tool published.</li>
      </ul>
      <p>We do not collect data about other TikTok users, do not read anyone&apos;s messages, and do not sell or share any data.</p>
      <h2>How it is stored</h2>
      <ul>
        <li>Tokens are stored only on our server, encrypted at rest, never in the browser and never in logs.</li>
        <li>Every publishing action is recorded in an audit log with who approved it and when.</li>
        <li>Nothing is posted without a team member&apos;s explicit approval of the exact video and caption.</li>
      </ul>
      <h2>Your choices</h2>
      <p>
        The connection can be revoked at any time in the tool (Connections) or in TikTok settings (Security → Manage app
        permissions). After revocation we delete the stored tokens.
      </p>
      <h2>Contact</h2>
      <p>hello@backapp.live</p>
    </>
  );
}

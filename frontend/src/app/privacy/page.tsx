import Link from "next/link";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0d0a25 0%, #1a1540 50%, #0d0a25 100%)" }}>
      {/* Background glow blobs */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full" style={{ background: "radial-gradient(circle, rgba(105,98,196,0.12) 0%, transparent 70%)" }} />
      <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full" style={{ background: "radial-gradient(circle, rgba(61,53,128,0.10) 0%, transparent 70%)" }} />

      <div className="relative z-10 min-h-screen py-12 px-6">
        {/* Back to login link */}
        <div className="max-w-3xl mx-auto mb-6">
          <Link href="/login" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back to Login
          </Link>
        </div>

        {/* Glass container */}
        <div
          className="max-w-3xl mx-auto rounded-3xl overflow-hidden"
          style={{
            background: "rgba(26,21,64,0.95)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(105,98,196,0.18)",
            boxShadow: "0 12px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(105,98,196,0.12), 0 0 0 1px rgba(105,98,196,0.06)",
          }}
        >
          {/* Logo header — attached to glass box */}
          <div className="flex items-center justify-center gap-3 py-5 border-b border-white/[0.08]" style={{ background: "linear-gradient(135deg, rgba(42,33,88,0.6) 0%, rgba(26,21,64,0.8) 100%)" }}>
            <img src="/images/logo-3.png" alt="Inertia Leads" className="h-12" />
          </div>

          <div className="px-8 md:px-12 py-10 caret-transparent">
            {/* Header */}
            <div className="mb-10">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 mb-4">
                <svg className="w-3.5 h-3.5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                <span className="text-xs font-medium text-violet-300">Legal</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-white">Privacy Policy</h1>
              <p className="text-white/40 text-sm mt-2">Last updated: June 8, 2026</p>
            </div>

            {/* Content */}
            <div className="space-y-8 text-white/70 text-sm leading-relaxed">

              {/* Notice */}
              <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
                <p className="text-amber-200/80 text-xs"><span className="font-semibold text-amber-300">Note:</span> Inertia Leads is currently operated as an independent product pending formal company registration. The operator of this Service is Aman Kumar, reachable at info@inertialeads.com. This policy will be updated with full legal entity details upon company registration.</p>
              </div>

              <p>
                Inertia Leads (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) operates the Inertia Leads platform (the &quot;Service&quot;), an AI-powered lead generation and email outreach tool. This Privacy Policy explains how we collect, use, store, and protect your information when you use our Service.
              </p>
              <p>
                By using Inertia Leads, you agree to the collection and use of information as described in this policy. If you do not agree, please do not use the Service.
              </p>

              {/* Section 1 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">1. Information We Collect</h2>

                <h3 className="text-sm font-semibold text-white/90 mt-4 mb-2">Account Information</h3>
                <p>When you create an account, we collect your name, email address, and password. Your password is securely hashed using industry-standard hashing algorithms and is never stored in plaintext.</p>

                <h3 className="text-sm font-semibold text-white/90 mt-4 mb-2">Profile Information</h3>
                <p>You may optionally provide a display name, bio, and profile photo. This information is entirely optional and can be updated or removed at any time.</p>

                <h3 className="text-sm font-semibold text-white/90 mt-4 mb-2">Email Account Credentials</h3>
                <p>When you connect Gmail or SMTP accounts for sending emails, we store OAuth tokens (for Gmail) and SMTP credentials. All tokens and credentials are encrypted using AES-256-GCM encryption at rest. They are never stored in plaintext and can be revoked by you at any time.</p>

                <h3 className="text-sm font-semibold text-white/90 mt-4 mb-2">Lead Data</h3>
                <p>When you use our lead finding feature, we collect publicly available business information including business names, email addresses, phone numbers, websites, addresses, and industry categories sourced from Google Maps and publicly accessible business websites. This is publicly listed information that businesses have made available for commercial contact.</p>

                <h3 className="text-sm font-semibold text-white/90 mt-4 mb-2">Email Content</h3>
                <p>We store AI-generated email subjects, bodies, send status, and reply status associated with your campaigns. This data is stored solely to operate the Service and is never used for any purpose other than providing the Service to you.</p>

                <h3 className="text-sm font-semibold text-white/90 mt-4 mb-2">Usage Data</h3>
                <p>We track your plan type, number of leads found, emails sent, and feature usage to enforce plan limits and improve our Service. This data is associated with your account and is never sold or shared with third parties.</p>

                <h3 className="text-sm font-semibold text-white/90 mt-4 mb-2">Payment Information</h3>
                <p>Payment processing is handled entirely by Dodo Payments. We do not store your credit card number, CVV, or full payment details. We only receive a customer ID and subscription status from Dodo Payments to manage your plan.</p>
              </div>

              {/* Section 2 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">2. How We Collect Information</h2>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li><span className="font-medium text-white/80">Directly from you:</span> When you sign up, update your profile, upload CSV files, or configure email accounts.</li>
                  <li><span className="font-medium text-white/80">From third-party APIs:</span> We use Serper.dev and Google Maps to find publicly listed business information based on your search queries. Only your search terms (niche and location) are shared — not your personal data.</li>
                  <li><span className="font-medium text-white/80">From public websites:</span> We collect publicly available business contact information from company websites that are already indexed by search engines. We only collect information that businesses have made publicly available.</li>
                  <li><span className="font-medium text-white/80">From Google OAuth:</span> When you connect Gmail, we request the minimum permissions necessary to send emails on your behalf. We do not read, scan, or store the content of your Gmail inbox.</li>
                </ul>
              </div>

              {/* Section 3 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">3. How We Use Your Information</h2>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>To provide and operate the lead finding, enrichment, and email outreach service</li>
                  <li>To authenticate your identity and manage your account</li>
                  <li>To send emails on your behalf via your connected Gmail or SMTP accounts</li>
                  <li>To generate AI-powered personalized email content using your lead and business data</li>
                  <li>To track and enforce plan-based usage limits</li>
                  <li>To improve, maintain, and develop new features for the Service</li>
                  <li>To communicate with you about your account, updates, or the Service</li>
                  <li>To comply with legal obligations</li>
                </ul>
                <p className="mt-3">We do not use your data for advertising, profiling, or any purpose not listed above.</p>
              </div>

              {/* Section 4 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">4. Lawful Basis for Processing (GDPR)</h2>
                <p className="mb-3">For users in the European Economic Area (EEA), United Kingdom, and other jurisdictions with similar data protection laws, we process your personal data under the following lawful bases as defined under GDPR Article 6:</p>
                <div className="overflow-x-auto border border-white/[0.20] rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/[0.06]">
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Lawful Basis</th>
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">When it applies</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Contract (Art. 6(1)(b))</td>
                        <td className="px-4 py-2.5">Processing necessary to provide the Service you signed up for — account management, sending emails, finding leads, generating reports</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Legitimate interests (Art. 6(1)(f))</td>
                        <td className="px-4 py-2.5">Usage analytics to improve the Service, fraud prevention, security monitoring. We have assessed that these interests do not override your rights.</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Consent (Art. 6(1)(a))</td>
                        <td className="px-4 py-2.5">Where you have explicitly provided consent — such as connecting your Gmail account or uploading contact data</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Legal obligation (Art. 6(1)(c))</td>
                        <td className="px-4 py-2.5">Where processing is required to comply with applicable law — such as responding to lawful requests from authorities</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 5 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">5. How We Protect Your Information</h2>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>All data is stored in Supabase, hosted on AWS infrastructure with SOC2 compliance</li>
                  <li>Gmail OAuth tokens and SMTP passwords are encrypted with AES-256-GCM before storage and are never stored in plaintext</li>
                  <li>All data transmission uses HTTPS/TLS encryption in transit</li>
                  <li>Row Level Security (RLS) is enforced on all database tables — users can only access their own data</li>
                  <li>API access is protected with JWT authentication, rate limiting, and input validation on every endpoint</li>
                  <li>OAuth state parameters are HMAC-signed to prevent cross-site request forgery (CSRF) attacks</li>
                  <li>SSRF protection is implemented on our website analysis infrastructure to prevent internal network access</li>
                </ul>

                <h3 className="text-sm font-semibold text-white/90 mt-4 mb-2">Data Breach Notification</h3>
                <p>In the event of a data breach that is likely to result in a risk to your rights and freedoms, we will notify you and relevant supervisory authorities within 72 hours of becoming aware of the breach, as required by GDPR Article 33 and applicable law. Notification will be sent to the email address associated with your account.</p>
              </div>

              {/* Section 6 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">6. International Data Transfers</h2>
                <p className="mb-3">Inertia Leads operates globally and uses third-party service providers based in the United States and other countries. Your data may be processed in countries outside your home country, including the United States, where data protection laws may differ from those in your jurisdiction.</p>
                <p className="mb-3">When transferring personal data from the EEA, UK, or Switzerland to countries not recognised as providing adequate protection, we rely on appropriate safeguards including Standard Contractual Clauses (SCCs) as approved by the European Commission, or other legally recognised transfer mechanisms.</p>
                <p className="mb-3">Our primary service providers and their data locations:</p>
                <div className="overflow-x-auto border border-white/[0.20] rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/[0.06]">
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Provider</th>
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Location</th>
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Transfer mechanism</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Supabase (AWS)</td>
                        <td className="px-4 py-2.5">United States</td>
                        <td className="px-4 py-2.5">Standard Contractual Clauses</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">OpenAI</td>
                        <td className="px-4 py-2.5">United States</td>
                        <td className="px-4 py-2.5">Standard Contractual Clauses</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Dodo Payments</td>
                        <td className="px-4 py-2.5">United States</td>
                        <td className="px-4 py-2.5">Standard Contractual Clauses</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Serper.dev</td>
                        <td className="px-4 py-2.5">United States</td>
                        <td className="px-4 py-2.5">Standard Contractual Clauses</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Google Gmail API</td>
                        <td className="px-4 py-2.5">United States</td>
                        <td className="px-4 py-2.5">Google&apos;s approved transfer mechanisms</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 7 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">7. Third-Party Services</h2>
                <p className="mb-3">We use the following third-party services to operate Inertia Leads. Each provider has their own privacy policy and data handling practices:</p>
                <div className="overflow-x-auto border border-white/[0.20] rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/[0.06]">
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Service</th>
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Purpose</th>
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Data shared</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Supabase</td>
                        <td className="px-4 py-2.5">Database, authentication, file storage</td>
                        <td className="px-4 py-2.5">Account data, lead data, encrypted credentials</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Google Gmail API</td>
                        <td className="px-4 py-2.5">Sending emails on your behalf</td>
                        <td className="px-4 py-2.5">Email content and recipient addresses you create</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">OpenAI</td>
                        <td className="px-4 py-2.5">AI email and audit report generation</td>
                        <td className="px-4 py-2.5">Business name, website summary, industry category only — no personal contact data of leads</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Serper.dev</td>
                        <td className="px-4 py-2.5">Lead finding via Google Maps</td>
                        <td className="px-4 py-2.5">Search queries only — niche and location</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Dodo Payments</td>
                        <td className="px-4 py-2.5">Payment processing and subscription management</td>
                        <td className="px-4 py-2.5">Billing name, email address, payment method</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Railway</td>
                        <td className="px-4 py-2.5">Backend hosting infrastructure</td>
                        <td className="px-4 py-2.5">Application data processed in transit</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Vercel</td>
                        <td className="px-4 py-2.5">Frontend hosting</td>
                        <td className="px-4 py-2.5">No personal data stored</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-3">We do not sell, rent, share, or monetize your personal data or lead data with any third parties for marketing, advertising, or any commercial purpose.</p>
              </div>

              {/* Section 8 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">8. Google API Disclosure</h2>
                <div className="p-4 rounded-xl bg-white/[0.04] border border-white/[0.08] mb-3">
                  <p className="text-white/80 text-xs">Inertia Leads&apos; use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.</p>
                </div>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>We only request the minimum scopes necessary: <code className="text-xs bg-white/[0.08] px-1.5 py-0.5 rounded text-violet-300">gmail.send</code> (to send emails you create) and <code className="text-xs bg-white/[0.08] px-1.5 py-0.5 rounded text-violet-300">userinfo.email</code> (to identify your Gmail address)</li>
                  <li>We do not read, scan, analyze, or store the content of your Gmail inbox at any time</li>
                  <li>We do not use Gmail data for advertising, profiling, or any purpose other than sending emails you explicitly create and approve through our platform</li>
                  <li>Gmail tokens are encrypted at rest using AES-256-GCM and can be revoked by you at any time by disconnecting your account in Settings</li>
                  <li>We do not share Gmail data with any third parties except as necessary to operate the email sending feature</li>
                </ul>
              </div>

              {/* Section 9 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">9. Data Retention</h2>
                <div className="overflow-x-auto border border-white/[0.20] rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/[0.06]">
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Data type</th>
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Retention period</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Account information</td>
                        <td className="px-4 py-2.5">Retained until you delete your account</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Lead data and campaigns</td>
                        <td className="px-4 py-2.5">Retained until you delete them or delete your account</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Gmail and SMTP credentials</td>
                        <td className="px-4 py-2.5">Retained until you disconnect the email account. Upon disconnection, encrypted tokens are permanently and immediately deleted</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">AI-generated email content</td>
                        <td className="px-4 py-2.5">Retained as part of your campaign history until you delete the campaign or your account</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Payment records</td>
                        <td className="px-4 py-2.5">Retained as required by financial and tax regulations — typically 7 years. Payment processing records are held by Dodo Payments</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Usage and analytics data</td>
                        <td className="px-4 py-2.5">Retained for 12 months then aggregated and anonymised</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Account deletion</td>
                        <td className="px-4 py-2.5">When you delete your account, all associated data including leads, campaigns, emails, connected accounts, and usage records is permanently deleted via cascade deletion within 30 days</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 10 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">10. Your Rights</h2>
                <p className="mb-3">Depending on your location you have the following rights regarding your personal data. We will respond to all requests within 30 days of receipt.</p>
                <div className="overflow-x-auto border border-white/[0.20] rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/[0.06]">
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Right</th>
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">What it means</th>
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">How to exercise</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Access</td>
                        <td className="px-4 py-2.5">Request a copy of the personal data we hold about you</td>
                        <td className="px-4 py-2.5">Email info@inertialeads.com</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Deletion</td>
                        <td className="px-4 py-2.5">Delete your account and all associated data at any time</td>
                        <td className="px-4 py-2.5">Settings → Delete account, or email us</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Portability</td>
                        <td className="px-4 py-2.5">Request an export of your lead and campaign data in CSV or JSON format</td>
                        <td className="px-4 py-2.5">Email info@inertialeads.com</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Correction</td>
                        <td className="px-4 py-2.5">Update your profile information at any time</td>
                        <td className="px-4 py-2.5">Settings page in your account</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Disconnection</td>
                        <td className="px-4 py-2.5">Remove connected Gmail or SMTP accounts at any time, permanently deleting stored credentials</td>
                        <td className="px-4 py-2.5">Settings → Connected accounts</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Objection</td>
                        <td className="px-4 py-2.5">Object to processing of your data for legitimate interests purposes</td>
                        <td className="px-4 py-2.5">Email info@inertialeads.com</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Restriction</td>
                        <td className="px-4 py-2.5">Request that we restrict processing of your data in certain circumstances</td>
                        <td className="px-4 py-2.5">Email info@inertialeads.com</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Complaint</td>
                        <td className="px-4 py-2.5">Lodge a complaint with your local data protection authority</td>
                        <td className="px-4 py-2.5">Contact your national DPA</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-3">We will respond to all data rights requests within 30 days of receipt. For complex requests we may extend this by a further 30 days with notification. We will never charge a fee for exercising your rights unless requests are manifestly unfounded or excessive.</p>
              </div>

              {/* Section 11 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">11. Email Outreach Compliance</h2>
                <p className="mb-3">Inertia Leads is a tool that enables users to send business-to-business outreach emails to publicly listed businesses from their own connected email account. Users are solely responsible for ensuring their use of the Service complies with all applicable laws and regulations in their jurisdiction, including but not limited to:</p>
                <div className="overflow-x-auto border border-white/[0.20] rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/[0.06]">
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Law</th>
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Jurisdiction</th>
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Key requirement</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">CAN-SPAM Act</td>
                        <td className="px-4 py-2.5">United States</td>
                        <td className="px-4 py-2.5">Clear identification, honest subject lines, opt-out mechanism, physical address</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">GDPR</td>
                        <td className="px-4 py-2.5">European Union</td>
                        <td className="px-4 py-2.5">Legitimate interests basis, clear identification, opt-out mechanism</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">CASL</td>
                        <td className="px-4 py-2.5">Canada</td>
                        <td className="px-4 py-2.5">Express or implied consent required, unsubscribe mechanism, sender identification</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">PECR</td>
                        <td className="px-4 py-2.5">United Kingdom</td>
                        <td className="px-4 py-2.5">Consent or legitimate interests, opt-out mechanism</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Spam Act 2003</td>
                        <td className="px-4 py-2.5">Australia</td>
                        <td className="px-4 py-2.5">Consent, clear identification, functional unsubscribe</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">UEM Act 2007</td>
                        <td className="px-4 py-2.5">New Zealand</td>
                        <td className="px-4 py-2.5">Consent, sender identification, unsubscribe mechanism</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-3">All outbound emails generated through our platform include a clear opt-out mechanism, allowing recipients to opt out at any time by replying to the email (for example, with &ldquo;STOP&rdquo;). We strongly encourage all users to respect opt-out requests immediately and maintain suppression lists. Inertia Leads reserves the right to suspend accounts that are reported for spam or that violate applicable email laws.</p>
              </div>

              {/* Section 12 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">12. Cookies and Local Storage</h2>
                <p className="mb-3">Inertia Leads uses the following browser technologies:</p>
                <div className="overflow-x-auto border border-white/[0.20] rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/[0.06]">
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Technology</th>
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Purpose</th>
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Can be disabled?</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Essential cookies</td>
                        <td className="px-4 py-2.5">Authentication and session management via Supabase Auth. Required for the Service to function.</td>
                        <td className="px-4 py-2.5">No — strictly necessary</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">localStorage</td>
                        <td className="px-4 py-2.5">Maintaining your session state and user preferences within the application. Not used for tracking.</td>
                        <td className="px-4 py-2.5">No — required for app function</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">sessionStorage</td>
                        <td className="px-4 py-2.5">Temporary session data during your active session. Cleared when you close the browser.</td>
                        <td className="px-4 py-2.5">No — required for app function</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-3">We do not use third-party tracking cookies, advertising cookies, or analytics cookies. We do not use any cross-site tracking technology. Your browsing behaviour outside of Inertia Leads is never monitored or collected.</p>
              </div>

              {/* Section 13 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">13. Children&apos;s Privacy</h2>
                <p>Inertia Leads is not intended for use by individuals under the age of 18. We do not knowingly collect personal information from children under 18. If we become aware that a child under 18 has provided us with personal data, we will take immediate steps to delete that information from our systems. If you believe a child has provided us with personal data, please contact us at <a href="mailto:info@inertialeads.com" className="text-violet-400 hover:text-violet-300 underline">info@inertialeads.com</a>.</p>
              </div>

              {/* Section 14 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">14. Changes to This Policy</h2>
                <p className="mb-3">We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors. When we make significant changes we will notify you via:</p>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>Email to the address associated with your account at least 14 days before changes take effect</li>
                  <li>An in-app notification when you next log in</li>
                  <li>A notice on our website at inertialeads.com</li>
                </ul>
                <p className="mt-3">Your continued use of the Service after changes take effect constitutes acceptance of the updated policy. If you do not agree with the changes you may delete your account before the changes take effect.</p>
                <p className="mt-2">The date at the top of this policy reflects when it was last updated. We recommend reviewing this policy periodically.</p>
              </div>

              {/* Section 15 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">15. Contact Us</h2>
                <p className="mb-3">If you have questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:</p>
                <div className="overflow-x-auto border border-white/[0.20] rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/[0.06]">
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Contact method</th>
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Email</td>
                        <td className="px-4 py-2.5"><a href="mailto:info@inertialeads.com" className="text-violet-400 hover:text-violet-300 underline">info@inertialeads.com</a></td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Website</td>
                        <td className="px-4 py-2.5"><a href="https://inertialeads.com" className="text-violet-400 hover:text-violet-300 underline" target="_blank" rel="noopener noreferrer">inertialeads.com</a></td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Response time</td>
                        <td className="px-4 py-2.5">We aim to respond to all privacy enquiries within 5 business days</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Data rights requests</td>
                        <td className="px-4 py-2.5">We respond to all formal data rights requests within 30 days</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Company registration note */}
              <div className="p-4 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                <p className="text-white/60 text-xs"><span className="font-semibold text-white/80">Company registration note:</span> Inertia Leads is currently operated as an independent product pending formal company registration. Upon registration, this policy will be updated to include the full legal entity name, registration number, registered address, and appointed Data Protection Officer where required by law.</p>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-10 pt-6 border-t border-white/[0.08] text-center">
              <p className="text-xs text-white/30">&copy; {new Date().getFullYear()} Inertia Leads. All rights reserved.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

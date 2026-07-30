import Link from "next/link";

export default function TermsOfServicePage() {
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
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 mb-4">
                <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                <span className="text-xs font-medium text-amber-300">Legal</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-white">Terms of Service</h1>
              <p className="text-white/40 text-sm mt-2">Last updated: June 8, 2026</p>
            </div>

            {/* Content */}
            <div className="space-y-8 text-white/70 text-sm leading-relaxed">

              {/* Notice */}
              <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
                <p className="text-amber-200/80 text-xs"><span className="font-semibold text-amber-300">Note:</span> Inertia Leads is currently operated as an independent product pending formal company registration. The operator of this Service is Aman Kumar, reachable at info@inertialeads.com. These Terms will be updated with full legal entity details upon company registration.</p>
              </div>

              <p>
                These Terms of Service (&quot;Terms&quot;) govern your access to and use of Inertia Leads (the &quot;Service&quot;), an AI-powered B2B lead generation and email outreach platform. By creating an account or using the Service, you agree to be bound by these Terms and our <Link href="/privacy" className="text-violet-400 hover:text-violet-300 underline">Privacy Policy</Link>, which is incorporated herein by reference.
              </p>
              <p>
                If you do not agree to these Terms, do not create an account or use the Service. If you are using the Service on behalf of an organisation, you represent that you have the authority to bind that organisation to these Terms.
              </p>

              {/* Section 1 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">1. Description of Service</h2>
                <p className="mb-3">Inertia Leads is an AI-powered B2B lead generation and email outreach platform that allows users to:</p>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>Find business leads by searching niches and locations via Google Maps data</li>
                  <li>Enrich leads by collecting publicly available business contact information from company websites</li>
                  <li>Generate personalized outreach emails and call scripts using AI based on lead website analysis</li>
                  <li>Generate personalized website audit reports for each lead highlighting their digital gaps</li>
                  <li>Send emails via connected Gmail or SMTP accounts with automated scheduling and business hours awareness</li>
                  <li>Track campaign performance including sends, replies, lead scores, and audit report views</li>
                  <li>Access a hot lead dashboard showing which leads have viewed their personalized audit report</li>
                </ul>
                <div className="mt-4 p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
                  <p className="text-blue-200/80 text-xs"><span className="font-semibold text-blue-300">Beta features:</span> Some features including CRM integration are listed as coming soon and are not yet available. We make no commitments regarding the timeline for delivery of coming soon features.</p>
                </div>
              </div>

              {/* Section 2 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">2. Account Registration and Eligibility</h2>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>You must be at least 18 years old to use the Service</li>
                  <li>You must provide accurate, current, and complete information when creating an account</li>
                  <li>You are responsible for maintaining the confidentiality and security of your account credentials</li>
                  <li>You are responsible for all activity that occurs under your account, whether or not you authorised it</li>
                  <li>You must notify us immediately at info@inertialeads.com if you suspect unauthorised access to your account</li>
                  <li>You may only create one account per person. Creating multiple accounts to circumvent plan limits is prohibited</li>
                  <li>We reserve the right to refuse registration or cancel accounts at our discretion</li>
                </ul>
              </div>

              {/* Section 3 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">3. Free Trial</h2>
                <p className="mb-3">We offer a 7-day free trial that begins automatically when you create an account. No payment method is required to start the trial. The following conditions apply:</p>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>The free trial starts immediately upon account creation and lasts for 7 calendar days — no credit card or payment method is required</li>
                  <li>During the trial you will have access to Growth plan features with reduced daily limits</li>
                  <li>When the trial ends, all paid features will be locked until you choose a subscription plan and provide a valid payment method</li>
                  <li>No automatic charges will occur at the end of the trial — you must actively select and pay for a plan to continue using paid features</li>
                  <li>Free trials are available once per person. We reserve the right to deny trial access to accounts we believe are attempting to abuse the trial policy</li>
                  <li>We reserve the right to modify or discontinue the free trial offer at any time without notice to new signups</li>
                </ul>
              </div>

              {/* Section 4 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">4. Acceptable Use</h2>
                <p className="mb-3">You agree to use the Service only for lawful business purposes. You must NOT use Inertia Leads to:</p>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>Send spam, unsolicited bulk emails, or messages that violate applicable anti-spam laws including CAN-SPAM, GDPR, CASL, and PECR</li>
                  <li>Harass, threaten, intimidate, or send abusive, offensive, or harmful content to any recipient</li>
                  <li>Send emails containing malware, phishing links, fraudulent content, or deceptive claims</li>
                  <li>Impersonate another person, business, or entity or misrepresent your identity or affiliation</li>
                  <li>Collect, extract, or use data for any purpose other than legitimate business outreach to publicly listed businesses</li>
                  <li>Resell, redistribute, license, or share lead data obtained through our Service with any third party</li>
                  <li>Attempt to circumvent, bypass, or disable rate limits, plan restrictions, or security measures</li>
                  <li>Use the Service in any way that could damage, disable, overburden, or impair our infrastructure or servers</li>
                  <li>Use automated scripts, bots, or tools to access the Service beyond normal use</li>
                  <li>Reverse engineer, decompile, or attempt to extract source code from any part of the Service</li>
                  <li>Use the Service for any illegal purpose or in violation of any applicable law or regulation</li>
                </ul>
                <p className="mt-3">Violation of these rules may result in immediate account suspension or termination without refund. We reserve the right to report illegal activity to appropriate law enforcement authorities.</p>
              </div>

              {/* Section 5 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">5. Email Sending and Compliance</h2>
                <p className="mb-3">You are solely responsible for the content of all emails sent through the Service and for ensuring your outreach complies with all applicable laws in the jurisdictions of both the sender and recipient. Key requirements include:</p>
                <div className="overflow-x-auto border border-white/[0.20] rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/[0.06]">
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Law</th>
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Jurisdiction</th>
                        <th className="text-left px-4 py-2.5 text-white/90 font-semibold border-b border-white/[0.08]">Your obligations</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">CAN-SPAM Act</td>
                        <td className="px-4 py-2.5">United States</td>
                        <td className="px-4 py-2.5">Accurate header information, honest subject lines, physical address in emails, honour opt-out requests within 10 business days</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">GDPR</td>
                        <td className="px-4 py-2.5">European Union / EEA</td>
                        <td className="px-4 py-2.5">Legitimate interests or consent basis for contacting individuals, clear identification, opt-out mechanism, no deceptive content</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">CASL</td>
                        <td className="px-4 py-2.5">Canada</td>
                        <td className="px-4 py-2.5">Express or implied consent required before sending, clear sender identification, functional unsubscribe mechanism</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">PECR</td>
                        <td className="px-4 py-2.5">United Kingdom</td>
                        <td className="px-4 py-2.5">Consent or legitimate interests basis, clear identification, opt-out mechanism</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Spam Act 2003</td>
                        <td className="px-4 py-2.5">Australia</td>
                        <td className="px-4 py-2.5">Consent, clear sender identification, functional unsubscribe link</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">UEM Act 2007</td>
                        <td className="px-4 py-2.5">New Zealand</td>
                        <td className="px-4 py-2.5">Consent, sender identification, functional unsubscribe mechanism</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-3">All emails sent through our Service include a clear opt-out mechanism: recipients can opt out at any time by replying to the email (for example, with &ldquo;STOP&rdquo;). You must not remove, disable, or tamper with the opt-out instructions included in your emails. You must honour all opt-out requests promptly, must not contact anyone who has opted out, and must maintain a suppression list of opted-out recipients.</p>
                <p className="mt-3">We reserve the right to suspend accounts that generate excessive spam complaints, bounce rates above 5%, or that we reasonably believe are violating applicable email laws.</p>
              </div>

              {/* Section 6 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">6. Gmail and SMTP Integration</h2>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>By connecting your Gmail or SMTP account, you authorise us to send emails on your behalf using your connected account</li>
                  <li>For Gmail connections, we request only the minimum permissions necessary: gmail.send (to send emails you create) and userinfo.email (to identify your Gmail address)</li>
                  <li>We do not read, scan, index, or access the content of your Gmail inbox at any time</li>
                  <li>All OAuth tokens and SMTP credentials are encrypted at rest using AES-256-GCM encryption and are never stored in plaintext</li>
                  <li>You may disconnect your email accounts at any time from the Settings page, which permanently and immediately deletes all stored credentials</li>
                  <li>You are responsible for ensuring your use of connected email accounts complies with the terms of service of your email provider (Google, Microsoft, or other)</li>
                  <li>We are not responsible for any sending limits, rate limiting, suspensions, bans, or restrictions imposed by Gmail, Microsoft, or any other email provider as a result of your usage patterns or content</li>
                  <li>The deliverability ramp-up feature is provided to help improve inbox placement over time by gradually increasing your daily sending volume from your own connected email account. Results may vary depending on your email provider, sending patterns, and content. Inertia Leads does not guarantee any specific deliverability rate or inbox placement outcome</li>
                  <li>Inertia Leads does not send, receive, or exchange any artificial or automated email traffic between accounts on your behalf. Every email sent through the Service is a message you have created and approved, addressed to a business recipient you selected</li>
                </ul>
              </div>

              {/* Section 7 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">7. Subscription Plans and Billing</h2>

                <h3 className="text-sm font-semibold text-white/90 mt-4 mb-2">Plans and Pricing</h3>
                <p>The Service offers three subscription plans with different feature limits: Starter ($39/month), Growth ($79/month), and Agency ($129/month). All prices are in USD. Full feature details for each plan are available at inertialeads.com/pricing.</p>

                <h3 className="text-sm font-semibold text-white/90 mt-4 mb-2">Billing</h3>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>Subscriptions are billed monthly on a recurring basis and processed through our payment provider Dodo Payments, who acts as Merchant of Record</li>
                  <li>Prices shown exclude applicable taxes. VAT, GST, sales tax, and other applicable taxes are calculated and collected by Dodo Payments based on your location</li>
                  <li>Your subscription renews automatically each month unless cancelled</li>
                  <li>By providing payment details, you authorise Dodo Payments to charge your payment method on a recurring monthly basis</li>
                </ul>

                <h3 className="text-sm font-semibold text-white/90 mt-4 mb-2">Cancellation</h3>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>You may cancel your subscription at any time through your account Settings or through the Dodo Payments customer portal</li>
                  <li>Cancellation takes effect at the end of your current billing period. You will retain full access to all your plan features until that date</li>
                  <li>No partial refunds or credits will be issued for the remaining days in your current billing cycle upon cancellation</li>
                  <li>Once the billing period ends, your account will lose access to paid features and you will not be charged again unless you resubscribe</li>
                  <li>Cancelling during the free trial incurs no charge as no payment method is collected during the trial</li>
                  <li>You may resubscribe at any time by selecting a new plan from your account Settings</li>
                </ul>

                <h3 className="text-sm font-semibold text-white/90 mt-4 mb-2">Refund Policy</h3>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>All subscription payments are non-refundable. When you cancel your subscription, you will continue to have access to your plan until the end of the current billing period — no refund will be issued for the remaining time</li>
                  <li>We do not offer refunds for partial months, unused features, or any period where the Service was available and accessible to you</li>
                  <li>If you upgrade or downgrade your plan mid-cycle, billing adjustments (proration) are handled automatically by Dodo Payments. No separate refund is issued for plan changes</li>
                  <li>In exceptional circumstances (e.g. extended service outage caused solely by us), we may issue discretionary credits or refunds at our sole judgement. Contact <a href="mailto:info@inertialeads.com" className="text-violet-400 hover:text-violet-300 underline">info@inertialeads.com</a> to request consideration</li>
                </ul>

                <h3 className="text-sm font-semibold text-white/90 mt-4 mb-2">Price Changes</h3>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>We reserve the right to change subscription pricing at any time</li>
                  <li>Existing subscribers will receive at least 30 days written notice of price changes via email to their registered address and via an in-app notification</li>
                  <li>If you do not agree to a price change you may cancel your subscription before the change takes effect</li>
                  <li>Continuing to use the Service after a price change takes effect constitutes acceptance of the new pricing</li>
                </ul>
              </div>

              {/* Section 8 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">8. Lead Data</h2>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>Lead data provided through our Service is sourced exclusively from publicly available information including Google Maps listings and publicly accessible business websites</li>
                  <li>We do not guarantee the accuracy, completeness, currency, or validity of any lead data including email addresses, phone numbers, or contact details</li>
                  <li>Email addresses and phone numbers found may be outdated, incorrect, or no longer in use. You are responsible for verifying lead data before taking action</li>
                  <li>Lead data is provided for your personal use within the Service only. You may not export, resell, sublicense, redistribute, or share lead data with third parties for any purpose</li>
                  <li>You must handle lead data in accordance with applicable data protection laws including GDPR, CASL, and CAN-SPAM</li>
                  <li>We are not responsible for any outcomes resulting from contacting leads found through our Service including but not limited to complaints, legal claims, or regulatory actions</li>
                </ul>
              </div>

              {/* Section 9 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">9. AI-Generated Content</h2>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>Emails, audit reports, and call scripts generated by our AI are suggestions based on publicly available business information and are provided for your review and approval</li>
                  <li>You are responsible for reviewing, editing, and approving all AI-generated content before sending or using it</li>
                  <li>We do not guarantee that AI-generated content will be accurate, appropriate, effective, or free from errors</li>
                  <li>AI-generated audit reports are based on automated website analysis and may not reflect the complete or current state of a lead&apos;s website or business</li>
                  <li>You are solely responsible for the final content sent to recipients and for any consequences arising from that content</li>
                  <li>AI models may occasionally produce inaccurate or inappropriate output. Do not send content you have not personally reviewed</li>
                </ul>
              </div>

              {/* Section 10 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">10. Intellectual Property</h2>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>The Service, including its design, interface, code, features, branding, and all associated intellectual property, is owned by Inertia Leads and protected by applicable intellectual property laws</li>
                  <li>You may not copy, modify, adapt, translate, distribute, sell, or create derivative works from any part of the Service without our express written permission</li>
                  <li>You retain full ownership of all data you upload to or create through the Service including your leads, campaigns, and email content</li>
                  <li>By using the Service, you grant us a limited, non-exclusive, royalty-free licence to process and store your data solely for the purpose of providing the Service to you</li>
                  <li>We do not claim ownership of your data and will not use your data for any purpose other than operating and improving the Service</li>
                  <li>Any feedback, suggestions, or ideas you provide regarding the Service may be used by us without obligation or compensation to you</li>
                </ul>
              </div>

              {/* Section 11 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">11. Service Availability</h2>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>We strive to maintain high availability of the Service but do not guarantee uninterrupted or error-free access</li>
                  <li>We may perform scheduled maintenance which may temporarily make the Service unavailable. We will endeavour to provide advance notice where reasonably possible</li>
                  <li>We rely on third-party services including Supabase, Google, OpenAI, and Serper.dev. We are not responsible for outages, interruptions, or degradation of service caused by those third-party providers</li>
                  <li>We are not liable for any loss of data, revenue, or business resulting from Service unavailability regardless of the cause</li>
                  <li>We do not provide a Service Level Agreement (SLA) or uptime guarantee at this time</li>
                </ul>
              </div>

              {/* Section 12 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">12. Account Suspension and Termination</h2>
                <p className="mb-3">We reserve the right to suspend or terminate your account immediately and without prior notice if you:</p>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>Violate these Terms of Service or our Acceptable Use policy</li>
                  <li>Use the Service to send spam, abusive content, or content that violates applicable law</li>
                  <li>Attempt to exploit, hack, reverse engineer, or circumvent security measures</li>
                  <li>Fail to pay for your subscription after a reasonable grace period</li>
                  <li>Provide false or misleading information during registration or use</li>
                  <li>Engage in fraudulent activity including attempting to abuse the free trial policy</li>
                  <li>Generate excessive spam complaints or bounce rates that put our infrastructure at risk</li>
                </ul>
                <p className="mt-3">You may terminate your account at any time by going to Settings and selecting Delete Account, or by contacting us at info@inertialeads.com.</p>
                <p className="mt-3">Upon termination for any reason, your access to the Service ceases immediately. All your data will be permanently deleted in accordance with our <Link href="/privacy" className="text-violet-400 hover:text-violet-300 underline">Privacy Policy</Link> within 30 days of account deletion.</p>
                <p className="mt-3">Termination does not entitle you to a refund of any prepaid subscription fees except as required by applicable law.</p>
              </div>

              {/* Section 13 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">13. Limitation of Liability</h2>
                <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20 mb-4">
                  <p className="text-red-200/80 text-xs"><span className="font-semibold text-red-300">Important:</span> Please read this section carefully. It limits our liability to you in important ways.</p>
                </div>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>The Service is provided on an &quot;as is&quot; and &quot;as available&quot; basis without warranties of any kind, whether express, implied, or statutory, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement</li>
                  <li>We do not warrant that the Service will be uninterrupted, error-free, secure, or free from viruses or other harmful components</li>
                  <li>We are not liable for any indirect, incidental, special, consequential, exemplary, or punitive damages arising from your use of or inability to use the Service, even if we have been advised of the possibility of such damages</li>
                  <li>We are not liable for any damages resulting from emails sent through the Service including but not limited to recipient complaints, email provider bans or restrictions, legal claims, regulatory fines, or reputational harm</li>
                  <li>We are not liable for the accuracy, completeness, or fitness for purpose of any AI-generated content or lead data provided through the Service</li>
                  <li>Our total aggregate liability to you for any and all claims related to the Service shall not exceed the total amount you paid us in the three months immediately preceding the event giving rise to the claim</li>
                  <li>Some jurisdictions do not allow the exclusion of certain warranties or the limitation of liability for certain types of damages. In such jurisdictions our liability is limited to the fullest extent permitted by applicable law</li>
                </ul>
                <p className="mt-3">Nothing in these Terms excludes or limits our liability for death or personal injury caused by our negligence, fraud or fraudulent misrepresentation, or any other liability that cannot be excluded or limited by applicable law.</p>
              </div>

              {/* Section 14 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">14. Indemnification</h2>
                <p className="mb-3">You agree to indemnify, defend, and hold harmless Inertia Leads, its operator, and any affiliates from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable legal fees) arising from or relating to:</p>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>Your use of or access to the Service</li>
                  <li>Your violation of these Terms or our Acceptable Use policy</li>
                  <li>Your violation of any applicable law or regulation including email and data protection laws</li>
                  <li>Any content you send through the Service</li>
                  <li>Any claims made by third parties as a result of emails, audit reports, or other content you send using the Service</li>
                  <li>Your infringement of any third-party intellectual property or privacy rights</li>
                </ul>
              </div>

              {/* Section 15 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">15. Dispute Resolution</h2>
                <p className="mb-3">Before initiating any formal legal proceedings, you agree to attempt to resolve any dispute with us informally by contacting info@inertialeads.com. We will make reasonable efforts to resolve disputes within 30 days of receiving written notice.</p>
                <p className="mb-3">For users in the European Union: Nothing in these Terms affects your right to bring a complaint before your national data protection authority or to use the EU Online Dispute Resolution platform at ec.europa.eu/consumers/odr.</p>
                <p>For users in the United Kingdom: You may refer unresolved disputes to the UK Centre for Effective Dispute Resolution (CEDR) or other applicable UK dispute resolution body.</p>
              </div>

              {/* Section 16 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">16. Governing Law and Jurisdiction</h2>
                <p className="mb-3">These Terms are governed by and construed in accordance with the laws of India, without regard to its conflict of law provisions.</p>
                <p className="mb-3">For users in the European Union: Notwithstanding the above, EU consumer protection laws and GDPR rights apply to EU users and cannot be overridden by choice of law. EU users retain all rights granted by EU law regardless of this governing law clause.</p>
                <p className="mb-3">For users in the United Kingdom: UK consumer protection laws and UK GDPR apply to UK users and are not affected by this governing law clause.</p>
                <p>Any disputes arising from these Terms or the Service that cannot be resolved informally shall be subject to the jurisdiction of the courts in India, except where mandatory local law requires otherwise.</p>
              </div>

              {/* Section 17 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">17. Force Majeure</h2>
                <p className="mb-3">We are not liable for any failure or delay in performing our obligations under these Terms where such failure or delay results from causes beyond our reasonable control, including but not limited to acts of God, natural disasters, pandemic, war, terrorism, government action, internet outages, power failures, third-party service outages (including Google, OpenAI, Supabase, or Dodo Payments), or other events beyond our reasonable control.</p>
                <p>In such circumstances we will use reasonable endeavours to resume normal service as quickly as possible and will notify affected users where practicable.</p>
              </div>

              {/* Section 18 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">18. Third-Party Services and Links</h2>
                <p className="mb-3">The Service integrates with and relies upon third-party services including Google Gmail API, OpenAI, Supabase, Serper.dev, and Dodo Payments. Your use of these third-party services is subject to their respective terms of service and privacy policies. We are not responsible for the practices, availability, or content of any third-party service.</p>
                <p>The Service may contain links to third-party websites. These links are provided for convenience only. We do not endorse, control, or assume responsibility for the content or practices of any linked third-party website.</p>
              </div>

              {/* Section 19 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">19. Entire Agreement and Severability</h2>
                <p className="mb-3">These Terms, together with our <Link href="/privacy" className="text-violet-400 hover:text-violet-300 underline">Privacy Policy</Link>, constitute the entire agreement between you and Inertia Leads regarding your use of the Service and supersede all prior or contemporaneous understandings, agreements, or communications.</p>
                <p className="mb-3">If any provision of these Terms is found to be invalid, illegal, or unenforceable by a court of competent jurisdiction, that provision shall be modified to the minimum extent necessary to make it enforceable, or severed if modification is not possible. The remaining provisions of these Terms shall continue in full force and effect.</p>
                <p>Our failure to enforce any right or provision of these Terms shall not constitute a waiver of that right or provision.</p>
              </div>

              {/* Section 20 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">20. Changes to These Terms</h2>
                <ul className="list-disc list-inside space-y-2 ml-1">
                  <li>We may update these Terms from time to time to reflect changes in our practices, features, legal requirements, or for other operational reasons</li>
                  <li>When we make significant changes, we will notify you at least 14 days before changes take effect via email to your registered address and via an in-app notification</li>
                  <li>Minor changes such as clarifications or corrections may be made without notice and will be reflected in the updated date at the top of this document</li>
                  <li>Your continued use of the Service after the effective date of updated Terms constitutes acceptance of the new Terms</li>
                  <li>If you do not agree to updated Terms, you must stop using the Service and may delete your account before the updated Terms take effect</li>
                </ul>
              </div>

              {/* Section 21 */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">21. Contact Us</h2>
                <p className="mb-3">If you have questions about these Terms of Service, contact us at:</p>
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
                        <td className="px-4 py-2.5">We aim to respond to all enquiries within 5 business days</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-white/80">Legal notices</td>
                        <td className="px-4 py-2.5">Legal notices must be sent to info@inertialeads.com with the subject line: Legal Notice</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
                  <p className="text-amber-200/80 text-xs"><span className="font-semibold text-amber-300">Company registration note:</span> Inertia Leads is currently operated as an independent product pending formal company registration. These Terms will be updated with the full legal entity name, registration number, and registered address upon incorporation.</p>
                </div>
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

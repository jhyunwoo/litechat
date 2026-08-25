# Store reviewer notes

Replace the bracketed account fields in the store consoles only. Do not commit the password.

## Shared reviewer access

- Username: **[MANUAL: stable production review username]**
- Password: **[MANUAL: password entered only in App Store Connect / Play Console]**
- The account must be active without VPN, invitation approval, employee SSO, region restrictions, special hardware, or developer-controlled OTP.
- Before submission, give the account one accepted demo friend and a non-sensitive demo conversation so realtime and safety features are immediately reproducible.

## Suggested Apple review notes

> litechat is a private 1:1 messaging app. Sign in with the review credentials above. The Chat tab shows conversations; Friends lets you search by username and exchange friend requests. Open a conversation to send text, emoji or an optional photo.
>
> Photo-library access is requested only after tapping the photo button. Notifications are optional and enabled from Profile; declining either permission does not block chat.
>
> To test user safety, open a conversation, long-press a message, then choose Report, or use the conversation header menu to report/block the user. Blocking prevents both participants from finding, friending, messaging or viewing each other's chat content.
>
> Account deletion is at Profile → Account management → Permanently delete account. It requires the current password and a second destructive confirmation, deletes server data and sessions, removes local credentials/caches, and returns to sign-in.
>
> The app has no social login, ads, purchases, subscriptions, third-party AI, background location or unrestricted web browser. `litechat://` is an internal custom scheme; Universal Links are not a product feature.

## Suggested Google App Access instructions

> Use the supplied username/password on the first screen. Core path: Chat → open demo conversation → send text/emoji; Friends → search by exact username; Profile → notification toggle, legal/support links and account management.
>
> Report: long-press a message and choose a reason. Block: open the conversation header action and confirm. Delete account: Profile → Account management → Permanently delete account, enter the current password and confirm.
>
> The same account can be deleted from https://chat.moveto.kr/account-deletion without installing the app. Please do not permanently delete the sole review account until other testing is complete; a second disposable deletion-test account should be supplied if deletion must be exercised.

## Pre-submission reviewer-account check

- [ ] Credentials work against `https://chat.moveto.kr` from a clean external network.
- [ ] Account is email/OTP independent and will not expire during review.
- [ ] A separate disposable account is available for deletion testing.
- [ ] At least one test conversation and friend are visible without using real personal data.
- [ ] Backend, image storage and notification provider will remain available throughout review.
- [ ] Reviewer notes match the exact submitted binary and production deployment.

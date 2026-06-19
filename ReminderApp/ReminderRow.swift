import SwiftUI

struct ReminderRow: View {
    let reminder: Reminder

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(reminder.title)
                        .font(.headline)
                    if !reminder.body.isEmpty {
                        Text(reminder.body)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    Label {
                        Text(reminder.date, style: .date) + Text(" at ") + Text(reminder.date, style: .time)
                    } icon: {
                        Image(systemName: "clock.fill")
                    }
                    .font(.caption)
                    .foregroundColor(.orange)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Image(systemName: "bell.fill").foregroundColor(.orange)
                    if reminder.whatsappEnabled {
                        Image(systemName: "message.fill").foregroundColor(.green)
                    }
                }
                .font(.subheadline)
            }

            if reminder.whatsappEnabled, !reminder.phoneNumber.isEmpty {
                Button {
                    let text = "\u{23F0} Reminder: \(reminder.title)" +
                               (reminder.body.isEmpty ? "" : "\n\(reminder.body)")
                    WhatsAppService.send(to: reminder.phoneNumber, message: text)
                } label: {
                    Label("Send on WhatsApp Now", systemImage: "arrow.up.message.fill")
                        .font(.caption.bold())
                        .foregroundColor(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.green)
                        .clipShape(Capsule())
                }
            }
        }
        .padding(.vertical, 4)
    }
}

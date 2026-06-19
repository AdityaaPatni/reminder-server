import SwiftUI

struct AddReminderView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var manager = ReminderManager.shared

    @State private var title = ""
    @State private var body = ""
    @State private var date = Date().addingTimeInterval(3600)
    @State private var enableWhatsApp = false
    @State private var phoneNumber = ""
    @State private var showWhatsAppInfo = false
    @State private var showSuccess = false
    @State private var showTestVibration = false

    var body: some View {
        NavigationView {
            Form {
                // MARK: - Details
                Section(header: Text("Reminder")) {
                    TextField("Title (e.g. Take medicine)", text: $title)
                    TextField("Description (optional)", text: $body)
                }

                // MARK: - Date & Time
                Section(header: Text("When")) {
                    DatePicker("Date & Time",
                               selection: $date,
                               in: Date()...,
                               displayedComponents: [.date, .hourAndMinute])
                    .datePickerStyle(.graphical)
                    .accentColor(.orange)
                }

                // MARK: - Alert type
                Section(header: Text("Alert")) {
                    HStack {
                        Label("Loud Sound + Vibration", systemImage: "bell.and.waves.left.and.right.fill")
                            .foregroundColor(.orange)
                        Spacer()
                        Image(systemName: "checkmark.circle.fill").foregroundColor(.green)
                    }
                    HStack {
                        Label("Breaks through Focus / Silent\nmode (Time Sensitive)",
                              systemImage: "exclamationmark.circle.fill")
                            .foregroundColor(.secondary)
                            .font(.caption)
                        Spacer()
                        Image(systemName: "checkmark.circle.fill").foregroundColor(.green)
                    }
                    Button {
                        manager.vibrate()
                        showTestVibration = true
                    } label: {
                        Label("Test Vibration Now", systemImage: "iphone.radiowaves.left.and.right")
                            .foregroundColor(.orange)
                    }
                }

                // MARK: - WhatsApp
                Section(header: Label("WhatsApp", systemImage: "message.fill")
                    .foregroundColor(.green)) {
                    Toggle(isOn: $enableWhatsApp) {
                        Label("Enable WhatsApp Reminder", systemImage: "message.fill")
                            .foregroundColor(.green)
                    }
                    if enableWhatsApp {
                        HStack {
                            Image(systemName: "phone.fill").foregroundColor(.secondary)
                            TextField("+91 98765 43210", text: $phoneNumber)
                                .keyboardType(.phonePad)
                        }
                        Button { showWhatsAppInfo = true } label: {
                            Label("How does WhatsApp reminder work?",
                                  systemImage: "info.circle")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }

                // MARK: - Save
                Section {
                    Button(action: save) {
                        HStack {
                            Spacer()
                            Label("Set Reminder", systemImage: "bell.badge.fill")
                                .font(.headline)
                                .foregroundColor(.white)
                            Spacer()
                        }
                        .padding(.vertical, 6)
                    }
                    .listRowBackground(title.isEmpty ? Color.gray : Color.orange)
                    .disabled(title.isEmpty)
                }
            }
            .navigationTitle("New Reminder")
            .navigationBarItems(leading: Button("Cancel") { dismiss() })
            .alert("How WhatsApp Reminders Work", isPresented: $showWhatsAppInfo) {
                Button("Got it", role: .cancel) {}
            } message: {
                Text("When your reminder fires, tap the notification to open the app. Then press \"Send on WhatsApp Now\" to instantly open WhatsApp with the message pre-filled and ready to send.")
            }
            .alert("Reminder Saved!", isPresented: $showSuccess) {
                Button("Done") { dismiss() }
            } message: {
                Text("You'll get a loud alert with vibration at the scheduled time.")
            }
        }
    }

    private func save() {
        let reminder = Reminder(
            title: title,
            body: body,
            date: date,
            whatsappEnabled: enableWhatsApp,
            phoneNumber: phoneNumber
        )
        manager.scheduleReminder(reminder)
        showSuccess = true
    }
}

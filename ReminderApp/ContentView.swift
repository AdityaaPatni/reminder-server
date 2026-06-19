import SwiftUI
import UserNotifications

struct ContentView: View {
    @StateObject private var manager = ReminderManager.shared
    @State private var showingAdd = false
    @State private var showingPermissionAlert = false

    var body: some View {
        NavigationView {
            Group {
                if manager.reminders.isEmpty {
                    emptyState
                } else {
                    List {
                        ForEach(manager.reminders) { reminder in
                            ReminderRow(reminder: reminder)
                        }
                        .onDelete(perform: manager.deleteReminders)
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Reminders")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        checkPermissionThenAdd()
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.title3)
                    }
                }
            }
        }
        .sheet(isPresented: $showingAdd) {
            AddReminderView()
        }
        .alert("Enable Notifications", isPresented: $showingPermissionAlert) {
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Please enable Notifications in Settings so reminders can play sound and vibrate.")
        }
        .onAppear {
            manager.requestPermission { granted in
                if !granted { showingPermissionAlert = true }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "bell.badge.fill")
                .font(.system(size: 64))
                .foregroundColor(.orange)
            Text("No Reminders Yet")
                .font(.title2.bold())
            Text("Tap + to add a reminder.\nIt will ring loudly and vibrate at the set time.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
    }

    private func checkPermissionThenAdd() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            DispatchQueue.main.async {
                if settings.authorizationStatus == .authorized ||
                   settings.authorizationStatus == .provisional {
                    showingAdd = true
                } else {
                    showingPermissionAlert = true
                }
            }
        }
    }
}

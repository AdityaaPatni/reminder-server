import Foundation
import UserNotifications
import AudioToolbox

class ReminderManager: ObservableObject {
    static let shared = ReminderManager()

    @Published var reminders: [Reminder] = []

    private let storageKey = "saved_reminders"

    init() {
        loadReminders()
    }

    func requestPermission(completion: @escaping (Bool) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .sound, .badge]
        ) { granted, _ in
            DispatchQueue.main.async { completion(granted) }
        }
    }

    func scheduleReminder(_ reminder: Reminder) {
        let content = UNMutableNotificationContent()
        content.title = reminder.title
        content.body = reminder.body.isEmpty ? "Time for your reminder!" : reminder.body
        content.sound = UNNotificationSound.default
        content.badge = 1
        // Time-sensitive interruption level: breaks through Focus modes (no special entitlement needed)
        content.interruptionLevel = .timeSensitive

        let components = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute, .second],
            from: reminder.date
        )
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        let request = UNNotificationRequest(identifier: reminder.id.uuidString,
                                            content: content,
                                            trigger: trigger)

        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                print("Failed to schedule: \(error.localizedDescription)")
            }
        }

        if !reminders.contains(where: { $0.id == reminder.id }) {
            reminders.append(reminder)
            saveReminders()
        }
    }

    func deleteReminders(at offsets: IndexSet) {
        let ids = offsets.map { reminders[$0].id.uuidString }
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids)
        reminders.remove(atOffsets: offsets)
        saveReminders()
    }

    // Trigger vibration in-app (e.g. for a test)
    func vibrate() {
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
    }

    private func saveReminders() {
        if let data = try? JSONEncoder().encode(reminders) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    private func loadReminders() {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let decoded = try? JSONDecoder().decode([Reminder].self, from: data)
        else { return }
        reminders = decoded
    }
}

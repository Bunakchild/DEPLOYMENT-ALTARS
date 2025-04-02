<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

require_once 'config.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $token = $data['token'] ?? '';
    $password = $data['password'] ?? '';

    if (empty($token) || empty($password)) {
        echo json_encode(['success' => false, 'error' => 'Token and password are required']);
        exit;
    }

    try {
        // Verify token and check expiry
        $stmt = $pdo->prepare("
            SELECT user_id 
            FROM password_resets 
            WHERE token = ? AND expiry > NOW() AND used = 0
        ");
        $stmt->execute([$token]);
        $reset = $stmt->fetch();

        if ($reset) {
            // Hash the new password
            $hashedPassword = password_hash($password, PASSWORD_DEFAULT);

            // Update user's password
            $stmt = $pdo->prepare("UPDATE students SET password = ? WHERE id = ?");
            $stmt->execute([$hashedPassword, $reset['user_id']]);

            // Mark token as used
            $stmt = $pdo->prepare("UPDATE password_resets SET used = 1 WHERE token = ?");
            $stmt->execute([$token]);

            echo json_encode(['success' => true, 'message' => 'Password has been reset successfully']);
        } else {
            echo json_encode(['success' => false, 'error' => 'Invalid or expired reset token']);
        }
    } catch (PDOException $e) {
        echo json_encode(['success' => false, 'error' => 'Database error']);
    }
} else {
    echo json_encode(['success' => false, 'error' => 'Invalid request method']);
}
?> 
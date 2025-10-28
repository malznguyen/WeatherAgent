import requests
import json
import os

# 1. Định nghĩa các tham số cần thiết
# Khóa API của bạn (giả định dùng cho OpenWeatherMap)
# LƯU Ý: Thay thế bằng phương pháp bảo mật hơn trong dự án chính thức (ví dụ: biến môi trường)
API_KEY = "46a04dd446b8e198028f38a5d97dafc9"

# Endpoint API (Dự báo 5 ngày / 3 giờ)
# Tham khảo: https://openweathermap.org/forecast5
BASE_URL = "http://api.openweathermap.org/data/2.5/forecast"

# 2. Thiết lập các Tham số Truy vấn (Query Parameters)
params = {
    'q': 'Hanoi, vn',  # Thành phố và mã quốc gia (Việt Nam)
    'units': 'metric', # Đơn vị: metric (độ C)
    'lang': 'vi',      # Ngôn ngữ phản hồi: Tiếng Việt
    'appid': API_KEY   # Khóa API để xác thực``
}

print(f"Đang gửi yêu cầu dự báo thời tiết cho: {params['q']}...")

# 3. Thực hiện Request HTTP GET
try:
    # Gửi yêu cầu GET đến API
    response = requests.get(BASE_URL, params=params)

    # Kiểm tra mã trạng thái HTTP (HTTP status code)
    response.raise_for_status() 

    # 4. Xử lý và In kết quả
    # Chuyển đổi phản hồi (response) sang định dạng JSON
    weather_data = response.json()
    
    # In ra thông tin tóm tắt và dữ liệu JSON (để kiểm tra)
    print("\n✅ Yêu cầu API thành công!")
    print(f"Thành phố: {weather_data.get('city', {}).get('name')}")
    print(f"Số lượng bản ghi dự báo (5 ngày / 3 giờ): {len(weather_data.get('list', []))}")
    print("-" * 50)
    
    # In ra 3 bản ghi dự báo đầu tiên để minh họa
    print("Dữ liệu 3 bản ghi đầu tiên:")
    for i in range(3):
        record = weather_data['list'][i]
        dt_txt = record['dt_txt']
        temp = record['main']['temp']
        description = record['weather'][0]['description']
        print(f"  > Thời gian: {dt_txt} | Nhiệt độ: {temp}°C | Mô tả: {description}")

    # (Tác tử Thu thập Dữ liệu sẽ chuyển 'weather_data' này cho Tác tử Phân tích)
    
except requests.exceptions.RequestException as e:
    # Xử lý các lỗi kết nối hoặc lỗi HTTP (4xx, 5xx)
    print(f"\n❌ Lỗi khi gọi API: {e}")
    if response is not None:
        print(f"Mã trạng thái HTTP: {response.status_code}")
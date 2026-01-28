# Steward

[![Build and Test](https://github.com/googlicius/obsidian-steward/actions/workflows/ci.yml/badge.svg)](https://github.com/googlicius/obsidian-steward/actions/workflows/ci.yml)

[English](README.md) | Tiếng Việt

Steward là một plugin sử dụng Mô hình Ngôn ngữ Lớn (LLM) để tương tác với Obsidian Vault của bạn. Plugin cung cấp khả năng tìm kiếm cực nhanh, quản lý vault liền mạch và tự động hóa mạnh mẽ. Được thiết kế với sự đơn giản và trải nghiệm AI sống động, Steward cho phép bạn tạo các lệnh và quy trình làm việc tinh vi để tự động hóa các tác vụ nhàm chán và lặp đi lặp lại.

## Tính năng

- **Công cụ tìm kiếm tích hợp**: Tìm kiếm dựa trên BM25 với tính năng chấm điểm độ liên quan và chấp nhận lỗi chính tả, nhanh hơn đáng kể so với tìm kiếm gốc của Obsidian.
- **Giao diện chat tương tác và thích ứng**: Một hoặc nhiều giao diện chat sử dụng dấu gạch chéo `/`, tận dụng các tính năng trình soạn thảo và chế độ đọc của Obsidian, có khả năng thích ứng với các theme hiện tại của bạn.
- **Tập trung vào quyền riêng tư**: Hầu hết các hành động được thực thi ở phía front-end bằng API Obsidian và dịch vụ cục bộ để tránh lộ dữ liệu của bạn cho LLM (ngoại trừ các truy vấn và nội dung bạn cung cấp một cách rõ ràng).
- **Tương tác dựa trên lệnh**: Hỗ trợ các lệnh tiêu chuẩn như search, vault (list, create, delete, copy, move, rename, update frontmatter), update, audio, tạo hình ảnh và các lệnh-do-người-dùng-định-nghĩa.
- **Linh hoạt về mô hình**: Sử dụng các mô hình AI yêu thích của bạn, bao gồm OpenAI, Gemini, DeepSeek, Ollama, v.v.
- **Dự phòng mô hình**: Tự động chuyển sang các mô hình thay thế khi xảy ra lỗi, đảm bảo thực thi lệnh ổn định.
- **Bộ nhớ đệm ý định**: Sử dụng embeddings để lưu trữ các truy vấn tương tự, giúp các yêu cầu tiếp theo cần ít token hơn cho việc xử lý LLM.
- **Hỗ trợ đa ngôn ngữ**: Sử dụng Steward bằng ngôn ngữ ưa thích của bạn.
- **lệnh-do-người-dùng-định-nghĩa**: Tạo quy trình lệnh riêng của bạn bằng cách kết hợp nhiều lệnh với các mô hình LLM và cài đặt cụ thể theo lựa chọn của bạn.

## Mục lục

- [Tính năng](#tính-năng)
- [Lệnh tiêu chuẩn (tích hợp sẵn)](#lệnh-tiêu-chuẩn-tích-hợp-sẵn)
  - [Cách sử dụng](#cách-sử-dụng)
  - [Trình diễn](#trình-diễn)
- [Lệnh do người dùng định nghĩa](#lệnh-do-người-dùng-định-nghĩa)
  - [Cách hoạt động](#cách-hoạt-động)
  - [Định nghĩa các trường](#định-nghĩa-các-trường)
  - [Cách sử dụng](#cách-sử-dụng-1)
  - [Ví dụ: định nghĩa lệnh-do-người-dùng-định-nghĩa](#ví-dụ-định-nghĩa-lệnh-do-người-dùng-định-nghĩa)
  - [Thêm system prompt bổ sung](#thêm-system-prompt-bổ-sung)
  - [Kích hoạt lệnh tự động](#kích-hoạt-lệnh-tự-động)
  - [Trình diễn lệnh-do-người-dùng-định-nghĩa](#trình-diễn-lệnh-do-người-dùng-định-nghĩa)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Cài đặt](#cài-đặt)
- [Phát triển](#phát-triển)
- [Đóng góp](#đóng-góp)
  - [Đóng góp mã nguồn](#đóng-góp-mã-nguồn)
  - [Lệnh do người dùng định nghĩa](#lệnh-do-người-dùng-định-nghĩa-1)
- [Giấy phép](#giấy-phép)

## Lệnh tiêu chuẩn (tích hợp sẵn)

Steward có thể được sử dụng trực tiếp trong trình soạn thảo hoặc bằng cách mở giao diện chat.

### Cách sử dụng

1. Nhấp vào biểu tượng "Open Steward chat" để mở cửa sổ chat
2. Gõ sau `/ ` trong chat hoặc trình soạn thảo đang hoạt động để tương tác hoặc gõ `/ ?` để xem các lệnh có sẵn
3. Để thêm dòng mới trong ô nhập lệnh, nhấn `Shift+Enter` (sử dụng thụt lề 2 khoảng trắng)
4. Để thay đổi mô hình, trong ô nhập, gõ `m:` hoặc `model:` và chọn từ danh sách thả xuống.
5. Để dừng lệnh đang chạy, nhấn phím `ESC` hoặc gõ `Stop` trong ô nhập lệnh.
6. Để hoàn tác thay đổi, gõ `Undo` trong ô nhập lệnh.

### Trình diễn

#### Cập nhật trực tiếp trong trình soạn thảo

<img src="/docs/Update-In-Editor.gif" alt="Cập nhật trực tiếp trong trình soạn thảo" width="400px">

#### Suy luận

<img src="/docs/Steward-Demo-Reasoning-2.gif" alt="Đọc hình ảnh" width="400px">

#### Danh sách việc cần làm và hoàn tác thay đổi

<img src="/docs/Steward-Demo-Todo-list-and-revert.gif" alt="Hoàn tác" width="400px">

#### Cập nhật vùng chọn

<img src="/docs/Stw-Demo-Update-selected-text-complex.gif" alt="Cập nhật vùng chọn" width="650px">

#### Tìm kiếm

<img src="/docs/Stw-Demo-Search-light.gif" alt="Tìm kiếm" width="650px">

## Lệnh do người dùng định nghĩa

Bạn có thể tạo **Lệnh-do-người-dùng-định-nghĩa** riêng để tự động hóa quy trình làm việc và kết hợp nhiều lệnh tích hợp hoặc lệnh-do-người-dùng-định-nghĩa khác thành một lệnh duy nhất, có thể tái sử dụng.

### Cách hoạt động

- Lệnh-do-người-dùng-định-nghĩa được định nghĩa dưới dạng khối YAML trong các file markdown bên trong thư mục `Steward/Commands`.
- Mỗi lệnh có thể chỉ định một chuỗi các lệnh tích hợp hoặc do người dùng định nghĩa để thực thi.
- Bạn có thể chỉ định liệu lệnh của bạn có yêu cầu đầu vào từ người dùng hay không bằng trường `query_required`.
- Các lệnh này có sẵn với tính năng tự động hoàn thành và được xử lý giống như các lệnh tích hợp.

### Định nghĩa các trường

- `command_name`: Tên bạn sẽ sử dụng để gọi lệnh (ví dụ: `/clean_up`)
- `query_required`: (tùy chọn, boolean) Nếu true, lệnh yêu cầu đầu vào từ người dùng sau tiền tố
- `model`: (tùy chọn, string) Mô hình sử dụng cho tất cả các lệnh trong lệnh-do-người-dùng-định-nghĩa này
- `system_prompt`: (tùy chọn, array) Thêm system prompt bổ sung áp dụng cho tất cả các bước trong lệnh này (xem [Thêm system prompt bổ sung](#thêm-system-prompt-bổ-sung))
- `use_tool`: (tùy chọn, boolean) Nếu false, không gửi hướng dẫn sử dụng công cụ
- `hidden`: (tùy chọn, boolean) Nếu true, lệnh sẽ không xuất hiện trong menu lệnh
- `triggers`: (tùy chọn, array) Tự động thực thi lệnh khi file đáp ứng tiêu chí được chỉ định (xem [Các trường trigger](#các-trường-trigger))
- `steps`: Chuỗi các lệnh tích hợp hoặc do người dùng định nghĩa để thực thi
  - `name`: (tùy chọn, string) Tên bước (ví dụ: `read`, `edit`, `search`, `vault`, `generate`, v.v.). Điều này tự động kích hoạt các công cụ tương ứng cho bước này. LƯU Ý: Sử dụng `generate` nếu bạn muốn AI phản hồi trực tiếp mà không sử dụng công cụ.
  - `system_prompt`: (tùy chọn, array) Thêm system prompt bổ sung cho bước lệnh này (xem [Thêm system prompt bổ sung](#thêm-system-prompt-bổ-sung))
  - `query`: (bắt buộc nếu `query_required` là true, string) Truy vấn gửi đến AI, đặt `$from_user` làm placeholder cho đầu vào của bạn
  - `model`: (tùy chọn, string) Mô hình sử dụng cho bước lệnh cụ thể này (ghi đè mô hình cấp lệnh)
  - `no_confirm`: (tùy chọn, boolean) Nếu true, bỏ qua các lời nhắc xác nhận cho bước lệnh này

### Cách sử dụng

1. Tạo một ghi chú trong `Steward/Commands` và thêm YAML lệnh của bạn trong khối code.
2. Trong bất kỳ ghi chú hoặc Chat nào, gõ lệnh của bạn (ví dụ: `/clean_up #Todo`) và nhấn Enter.
3. Lệnh sẽ thực thi chuỗi đã định nghĩa, sử dụng đầu vào của bạn nếu được yêu cầu.

### Ví dụ: định nghĩa lệnh-do-người-dùng-định-nghĩa

```yaml
command_name: clean_up
description: Dọn dẹp vault
query_required: false
model: gpt-4o # Tùy chọn: Chỉ định mô hình mặc định cho tất cả các lệnh
steps:
  - name: search
    query: 'Các ghi chú có tên bắt đầu bằng Untitled hoặc có tag #delete'

  - name: vault
    query: 'Xóa chúng'
    model: gpt-3.5-turbo # Tùy chọn: Ghi đè mô hình cho bước cụ thể này
```

### Thêm system prompt bổ sung

Steward sử dụng một agent duy nhất (SuperAgent) có system prompt cốt lõi là nền tảng chức năng của nó và không thể chỉnh sửa. Tuy nhiên, bạn có thể thêm system prompt bổ sung bằng trường `system_prompt`. Các prompt bổ sung này được nối vào system prompt cốt lõi, cho phép bạn cung cấp thêm ngữ cảnh hoặc hướng dẫn. Bạn có thể vô hiệu hóa việc gửi system prompt cốt lõi bằng cách đặt `use_tool: false`.

Bạn có thể thêm system prompt ở hai cấp độ:

- **Cấp độ gốc (Root level)**: Áp dụng cho tất cả các bước trong lệnh
- **Cấp độ bước (Step level)**: Chỉ áp dụng cho bước cụ thể đó (prompt cấp gốc được áp dụng trước, sau đó đến prompt cấp bước)

Thêm hướng dẫn bổ sung dưới dạng mảng các chuỗi:

**System prompt cấp gốc (áp dụng cho tất cả các bước):**

```yaml
command_name: my_command
system_prompt:
  - '[[#Guidelines]]' # Liên kết đến tiêu đề Guidelines (nội dung dưới tiêu đề sẽ được bao gồm)
  - 'Luôn sử dụng ngôn ngữ trang trọng'
steps:
  - query: |
    Đọc nội dung ở trên và giúp tôi với:
    $from_user
```

**System prompt cấp bước (chỉ áp dụng cho các bước cụ thể):**

```yaml
steps:
  - name: generate
    system_prompt:
      - '[[My Context Note]]' # Liên kết đến một ghi chú (nội dung sẽ được bao gồm)
      - 'Tập trung vào chi tiết kỹ thuật'
      - 'Cung cấp ví dụ'
    query: $from_user
```

#### Sử dụng liên kết trong system prompt

Tham chiếu nội dung của các ghi chú khác trong vault của bạn bằng liên kết Obsidian:

```yaml
command_name: search_with_context
steps:
  - name: search
    system_prompt:
      - '[[Search instruction]]' # Nội dung của ghi chú "Search instruction" sẽ được bao gồm làm system prompt.
      - '[[Some note#Instructions]]' # Chỉ nội dung dưới tiêu đề Instructions của "Some note" sẽ được bao gồm làm system prompt.
      - '[[#Instructions]]' # Chỉ nội dung dưới tiêu đề Instructions của ghi chú hiện tại sẽ được bao gồm làm system prompt.
    query: $from_user
```

Khi thực thi:

1. Liên kết `[[Search instruction]]` sẽ được thay thế bằng toàn bộ nội dung của ghi chú đó
2. Liên kết `[[Some note#Instructions]]` sẽ được thay thế bằng chỉ nội dung dưới tiêu đề "Instructions" trong ghi chú đó
3. Liên kết `[[#Instructions]]` sẽ được thay thế bằng chỉ nội dung dưới tiêu đề "Instructions" trong **ghi chú hiện tại** nơi lệnh-do-người-dùng-định-nghĩa được định nghĩa.
4. Bạn có thể cập nhật các ghi chú được liên kết độc lập với định nghĩa lệnh của bạn

### Kích hoạt lệnh tự động

Lệnh-do-người-dùng-định-nghĩa có thể được cấu hình để tự động thực thi khi các sự kiện file cụ thể xảy ra.

#### Cấu hình trigger

Thêm mảng `triggers` vào định nghĩa lệnh của bạn để chỉ định khi nào lệnh nên tự động thực thi:

```yaml
command_name: inbox_processor
query_required: false
triggers:
  - events: [create]
    folders: ['Inbox']
  - events: [modify]
    patterns:
      tags: ['#process']
      status: 'pending'
steps:
  - name: read
    query: 'Đọc nội dung của $file_name'
  - name: generate
    query: 'Phân loại và đề xuất cải tiến'
```

#### Các trường trigger

- `events`: (bắt buộc, array) Danh sách các sự kiện cần theo dõi: `create`, `modify`, `delete`
- `folders`: (tùy chọn, array) Đường dẫn thư mục cần theo dõi (ví dụ: `["Inbox", "Daily Notes"]`)
- `patterns`: (tùy chọn, object) Tiêu chí khớp mẫu (tất cả phải khớp):
  - `tags`: Tag cần khớp (ví dụ: `["#todo", "#review"]` hoặc `"#todo"`)
  - `content`: Mẫu regex để khớp nội dung file
  - Bất kỳ tên thuộc tính frontmatter nào (ví dụ: `status: "draft"`, `priority: ["high", "urgent"]`)

#### Placeholder trong trigger

Khi một lệnh được kích hoạt, bạn có thể sử dụng các placeholder sau:

- `$file_name`: Tên của ghi chú đã kích hoạt lệnh

#### Ví dụ thực tế

**Quy trình dựa trên tag:**

```yaml
triggers:
  - events: [modify]
    patterns:
      tags: '#flashcard-gen'
```

**Quy trình dựa trên thuộc tính:**

```yaml
triggers:
  - events: [modify]
    patterns:
      status: 'draft'
      type: 'article'
```

**Khớp mẫu nội dung:**

```yaml
triggers:
  - events: [modify]
    patterns:
      content: '\\[ \\]|TODO:|FIXME:'
```

#### Cách trigger hoạt động

1. Khi sự kiện file xảy ra (create/modify/delete), hệ thống kiểm tra tất cả các điều kiện trigger
2. Đối với sự kiện `modify`, hệ thống đợi metadata cache cập nhật, sau đó kiểm tra xem các pattern có mới được thêm vào không
3. Nếu tất cả pattern khớp và mới (đối với sự kiện modify), một ghi chú hội thoại sẽ được tạo tự động
4. Lệnh được kích hoạt thực thi trong ghi chú hội thoại này

### Tài nguyên có thể tải xuống

Hướng dẫn và lệnh-do-người-dùng-định-nghĩa từ cộng đồng có thể được tải trực tiếp từ [Steward repo](https://github.com/googlicius/obsidian-steward). Khi được tải về, hướng dẫn được lưu trong `Steward/Docs/` và lệnh được lưu trong `Steward/Commands/` trong vault của bạn. Gõ `/ Help` hoặc `/ ? ` trong chat để truy cập các hướng dẫn và lệnh cộng đồng có sẵn.

### Trình diễn lệnh-do-người-dùng-định-nghĩa

#### Hỗ trợ flashcard:

<img src="/docs/Flashcard-Assist-command.gif" alt="Hỗ trợ Flashcard" width="650px">

#### Lệnh tự động [Word processor](/community-UDCs/Word%20processor.md)

<img src="/docs/Steward-Demo-Automated.gif" alt="Hỗ trợ Flashcard" width="650px">

### Lệnh-do-người-dùng-định-nghĩa từ cộng đồng

Thư mục [community-UDCs](/community-UDCs/) chứa các lệnh-do-người-dùng-định-nghĩa được đóng góp bởi cộng đồng. Các lệnh này thể hiện tính linh hoạt của lệnh-do-người-dùng-định-nghĩa, cho phép bạn tạo các chế độ tương tác tùy chỉnh phù hợp với nhu cầu của bạn.

Các lệnh có sẵn:

- [Ask](/community-UDCs/ask.md) - Đặt câu hỏi mà không thay đổi vault của bạn
- [Plan](/community-UDCs/Plan.md) - Lên kế hoạch và phác thảo tác vụ trước khi thực thi
- [Clean up](/community-UDCs/Clean%20up.md) - Dọn dẹp vault bằng cách xóa các ghi chú không mong muốn
- [Word processor](/community-UDCs/Word%20processor.md) - Xử lý và định dạng văn bản trong ghi chú của bạn

Hãy sử dụng các lệnh này làm nguồn cảm hứng để tạo lệnh riêng của bạn!

## Cấu trúc thư mục

Steward tạo cấu trúc thư mục sau trong vault của bạn:

```
Steward/
├── Commands/       # Lưu trữ định nghĩa lệnh-do-người-dùng-định-nghĩa
├── Conversations/  # Lưu trữ các cuộc hội thoại trước đó
├── Docs/           # Tài liệu được tải từ repo này
├── Release notes/  # Ghi chú phát hành của Steward
├── Trash/          # Lưu trữ các file đã xóa
└── Steward chat.md # Cuộc hội thoại đang hoạt động hiện tại
```

## Cài đặt

### Từ Obsidian Community Plugins

1. Tải plugin từ trình duyệt Obsidian Community Plugins
2. Kích hoạt plugin trong cài đặt Obsidian của bạn
3. Cấu hình API key trong cài đặt plugin

### Cài đặt thủ công

1. Tải phiên bản mới nhất từ [trang releases](https://github.com/googlicius/obsidian-steward/releases)
2. Giải nén file zip vào thư mục `.obsidian/plugins` trong Obsidian vault của bạn
3. Kích hoạt plugin trong cài đặt Obsidian của bạn
4. Cấu hình API key trong cài đặt plugin

## Phát triển

Plugin này sử dụng TypeScript và tuân theo kiến trúc plugin của Obsidian.

### Build

1. Clone repository này
2. Chạy `npm install` để cài đặt dependencies
3. Chạy `npm run build` để build phiên bản production

## Đóng góp

Chào mừng các đóng góp cho Steward! Đây là cách bạn có thể đóng góp:

### Đóng góp mã nguồn

1. Fork repository
2. Tạo nhánh tính năng (`git checkout -b feature/amazing-feature`)
3. Commit các thay đổi của bạn (`git commit -m 'Add some amazing feature'`)
4. Push lên nhánh (`git push origin feature/amazing-feature`)
5. Mở Pull Request

### Lệnh do người dùng định nghĩa

Bạn có thể đóng góp Lệnh-do-người-dùng-định-nghĩa (UDC) của bạn để giúp đỡ cộng đồng:

1. Tạo UDC của bạn theo hướng dẫn trong [phần Lệnh-do-người-dùng-định-nghĩa](#lệnh-do-người-dùng-định-nghĩa)
2. Kiểm tra kỹ UDC của bạn để đảm bảo nó hoạt động như mong đợi
3. Thêm UDC của bạn vào thư mục `community-UDCs` với tên mô tả
4. Bao gồm tài liệu rõ ràng trong file UDC của bạn giải thích:
   - Lệnh làm gì
   - Cách sử dụng
   - Bất kỳ điều kiện tiên quyết hoặc dependencies nào
   - Các kịch bản sử dụng ví dụ

## Giấy phép

MIT

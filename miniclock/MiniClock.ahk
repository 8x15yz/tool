#SingleInstance Force
#Persistent
#NoEnv
SetBatchLines, -1
CoordMode, Mouse, Screen

; ============================================================
; 설정 및 이미지 패키징 (내장 처리)
; ============================================================

; 임시 폴더(A_Temp)에 이미지를 추출하여 사용
ImagePath := A_Temp . "\puppy_clock_dog.png"

; FileInstall, [프로젝트 폴더의 원본 파일명], [추출될 경로], [덮어쓰기 여부(1)]
; ※ exe 변환 시 스크립트와 같은 폴더에 dog.png가 존재해야 여기에 포함됩니다.
FileInstall, dog.png, %ImagePath%, 1

; 최초 크기
WidgetW := 300

; 원본 이미지 비율 (dog.png 1464x1742 기준)
BaseImageW := 1464
BaseImageH := 1742

WidgetH := Round(WidgetW * BaseImageH / BaseImageW)

MinW := 160
MaxW := 600

EditMode := false
Dragging := false
Resizing := false
MovedWhileDown := false

; ============================================================
; GDI+ 시작
; ============================================================

pToken := Gdip_Startup()

if (!pToken) {
    MsgBox, 16, 오류, GDI+를 시작할 수 없습니다.
    ExitApp
}

pBitmap := Gdip_CreateBitmapFromFile(ImagePath)

if (!pBitmap) {
    MsgBox, 16, 오류, dog.png 이미지를 불러올 수 없습니다.`n`n%ImagePath%
    ExitApp
}

; ============================================================
; 메인 GUI
; ============================================================

Gui, Main:New, +AlwaysOnTop -Caption +ToolWindow +E0x80000 +LastFound
Gui, Main:Show, NA w%WidgetW% h%WidgetH%, PuppyClock

MainHwnd := WinExist()

; 시작 위치
SysGet, WorkArea, MonitorWorkArea

WidgetX := WorkAreaRight - WidgetW - 30
WidgetY := WorkAreaBottom - WidgetH - 20

WinMove, ahk_id %MainHwnd%,, %WidgetX%, %WidgetY%, %WidgetW%, %WidgetH%

; ============================================================
; Resize handle
; ============================================================

Gui, Handle:New, +AlwaysOnTop -Caption +ToolWindow +LastFound
Gui, Handle:Color, FFFFFF
Gui, Handle:Add, Text, x0 y-3 w16 h20 Center BackgroundTrans, ■
HandleHwnd := WinExist()

; ============================================================
; 마우스 이벤트
; ============================================================

OnMessage(0x0201, "WM_LBUTTONDOWN")
OnMessage(0x0202, "WM_LBUTTONUP")
OnMessage(0x0200, "WM_MOUSEMOVE")

; ============================================================
; 시계
; ============================================================

SetTimer, UpdateClock, 1000

RenderWidget()
return


; ============================================================
; 시간 업데이트
; ============================================================

UpdateClock:
    RenderWidget()
return


; ============================================================
; 메인 렌더링
; ============================================================

RenderWidget() {
    global MainHwnd, pBitmap, WidgetX, WidgetY, WidgetW, WidgetH

    hdc := CreateCompatibleDC()
    hbm := CreateDIBSection(WidgetW, WidgetH)
    obm := SelectObject(hdc, hbm)

    G := Gdip_GraphicsFromHDC(hdc)

    ; 부드러운 이미지 축소 (InterpolationModeHighQualityBicubic = 7)
    DllCall("gdiplus\GdipSetInterpolationMode", "Ptr", G, "Int", 7)

    ; 강아지 + 말풍선 PNG
    Gdip_DrawImage(G, pBitmap, 0, 0, WidgetW, WidgetH)

    ; 시간 계산 및 출력
    FormatTime, CurrentTime,, HH:mm:ss

    ; 말풍선 내부 영역 범위 설정
    TextX := Round(WidgetW * 0.05)
    TextY := Round(WidgetH * 0.03)
    TextW := Round(WidgetW * 0.90)
    TextH := Round(WidgetH * 0.45)

    FontSize := Round(WidgetW * 0.175)

    Gdip_DrawCenteredText(G
        , CurrentTime
        , "Segoe UI"
        , FontSize
        , TextX
        , TextY
        , TextW
        , TextH)

    ; Layered Window 갱신
    UpdateLayeredWindow(MainHwnd, hdc, WidgetX, WidgetY, WidgetW, WidgetH)

    SelectObject(hdc, obm)
    DeleteObject(hbm)
    DeleteDC(hdc)
    Gdip_DeleteGraphics(G)
}


; ============================================================
; 좌클릭
; ============================================================

WM_LBUTTONDOWN(wParam, lParam, msg, hwnd) {
    global MainHwnd, HandleHwnd, EditMode, Dragging, Resizing, MovedWhileDown
    global DragStartX, DragStartY, StartWidgetX, StartWidgetY, StartWidgetW

    MouseGetPos, mx, my

    ; 크기조절 핸들 클릭
    if (hwnd = HandleHwnd) {
        Resizing := true
        DragStartX := mx
        DragStartY := my
        StartWidgetW := GetWidgetWidth()
        SetTimer, ResizeLoop, 10
        return
    }

    ; 본체 클릭
    if (hwnd = MainHwnd) {
        MovedWhileDown := false

        if (!EditMode) {
            EditMode := true
            ShowEditUI()
            return
        }

        ; 편집 모드 상태에서 드래그 준비
        Dragging := true
        DragStartX := mx
        DragStartY := my
        GetWidgetPosition(StartWidgetX, StartWidgetY)
        SetTimer, DragLoop, 10
        return
    }
}


; ============================================================
; 마우스 버튼 해제
; ============================================================

WM_LBUTTONUP(wParam, lParam, msg, hwnd) {
    global MainHwnd, EditMode, Dragging, Resizing, MovedWhileDown

    SetTimer, DragLoop, Off
    SetTimer, ResizeLoop, Off

    ; 편집 모드에서 위치 이동(드래그) 없이 단순 클릭만 한 경우 편집 모드 비활성화
    if (hwnd = MainHwnd && EditMode && Dragging && !MovedWhileDown) {
        HideEditUI()
    }

    Dragging := false
    Resizing := false

    RenderWidget()
    if (EditMode)
        UpdateEditUI()
}


WM_MOUSEMOVE(wParam, lParam, msg, hwnd) {
    return
}


; ============================================================
; 이동 Loop
; ============================================================

DragLoop:
    if (!Dragging) {
        SetTimer, DragLoop, Off
        return
    }

    MouseGetPos, mx, my

    dx := mx - DragStartX
    dy := my - DragStartY

    if (Abs(dx) > 3 || Abs(dy) > 3) {
        MovedWhileDown := true
    }

    WidgetX := StartWidgetX + dx
    WidgetY := StartWidgetY + dy

    RenderWidget()
    UpdateEditUI()
return


; ============================================================
; 크기 조절 Loop
; ============================================================

ResizeLoop:
    if (!Resizing) {
        SetTimer, ResizeLoop, Off
        return
    }

    MouseGetPos, mx, my

    dx := mx - DragStartX
    NewW := StartWidgetW + dx

    if (NewW < MinW)
        NewW := MinW
    if (NewW > MaxW)
        NewW := MaxW

    WidgetW := NewW
    WidgetH := Round(WidgetW * BaseImageH / BaseImageW)

    RenderWidget()
    UpdateEditUI()
return


; ============================================================
; 편집 UI
; ============================================================

ShowEditUI() {
    global EditMode
    EditMode := true
    UpdateEditUI()
}


UpdateEditUI() {
    global EditMode, WidgetX, WidgetY, WidgetW, WidgetH

    if (!EditMode)
        return

    Border := 2
    HandleSize := 16

    Gui, EditTop:New, +AlwaysOnTop -Caption +ToolWindow +E0x20
    Gui, EditTop:Color, 6B7280
    Gui, EditTop:Show, % "NA x" WidgetX " y" WidgetY " w" WidgetW " h" Border

    BottomY := WidgetY + WidgetH - Border
    Gui, EditBottom:New, +AlwaysOnTop -Caption +ToolWindow +E0x20
    Gui, EditBottom:Color, 6B7280
    Gui, EditBottom:Show, % "NA x" WidgetX " y" BottomY " w" WidgetW " h" Border

    Gui, EditLeft:New, +AlwaysOnTop -Caption +ToolWindow +E0x20
    Gui, EditLeft:Color, 6B7280
    Gui, EditLeft:Show, % "NA x" WidgetX " y" WidgetY " w" Border " h" WidgetH

    RightX := WidgetX + WidgetW - Border
    Gui, EditRight:New, +AlwaysOnTop -Caption +ToolWindow +E0x20
    Gui, EditRight:Color, 6B7280
    Gui, EditRight:Show, % "NA x" RightX " y" WidgetY " w" Border " h" WidgetH

    HandleX := WidgetX + WidgetW - (HandleSize // 2)
    HandleY := WidgetY + WidgetH - (HandleSize // 2)
    Gui, Handle:Show, % "NA x" HandleX " y" HandleY " w" HandleSize " h" HandleSize
}


HideEditUI() {
    global EditMode
    EditMode := false

    Gui, EditTop:Destroy
    Gui, EditBottom:Destroy
    Gui, EditLeft:Destroy
    Gui, EditRight:Destroy
    Gui, Handle:Hide
}


GetWidgetPosition(ByRef x, ByRef y) {
    global WidgetX, WidgetY
    x := WidgetX
    y := WidgetY
}


GetWidgetWidth() {
    global WidgetW
    return WidgetW
}


; ============================================================
; 키보드 단축키
; ============================================================

Esc::
    if (EditMode) {
        HideEditUI()
    }
return

^Esc::
    ExitApp
return


; ============================================================
; GDI+ 바인딩 함수
; ============================================================

Gdip_Startup() {
    if !DllCall("GetModuleHandle", "Str", "gdiplus", "Ptr")
        DllCall("LoadLibrary", "Str", "gdiplus")

    VarSetCapacity(si, 24, 0)
    NumPut(1, si, 0, "UInt")
    DllCall("gdiplus\GdiplusStartup", "Ptr*", pToken, "Ptr", &si, "Ptr", 0)
    return pToken
}


Gdip_Shutdown(pToken) {
    DllCall("gdiplus\GdiplusShutdown", "Ptr", pToken)
}


Gdip_CreateBitmapFromFile(File) {
    DllCall("gdiplus\GdipCreateBitmapFromFile", "WStr", File, "Ptr*", pBitmap)
    return pBitmap
}


Gdip_DisposeImage(pBitmap) {
    DllCall("gdiplus\GdipDisposeImage", "Ptr", pBitmap)
}


Gdip_GraphicsFromHDC(hdc) {
    DllCall("gdiplus\GdipCreateFromHDC", "Ptr", hdc, "Ptr*", G)
    return G
}


Gdip_DeleteGraphics(G) {
    DllCall("gdiplus\GdipDeleteGraphics", "Ptr", G)
}


Gdip_DrawImage(G, pBitmap, x, y, w, h) {
    DllCall("gdiplus\GdipDrawImageRectI", "Ptr", G, "Ptr", pBitmap, "Int", x, "Int", y, "Int", w, "Int", h)
}


Gdip_DrawCenteredText(G, Text, FontName, FontSize, x, y, w, h) {
    DllCall("gdiplus\GdipCreateFontFamilyFromName", "WStr", FontName, "Ptr", 0, "Ptr*", FontFamily)
    if (!FontFamily)
        DllCall("gdiplus\GdipGetGenericSansSerif", "Ptr*", FontFamily)

    DllCall("gdiplus\GdipCreateFont", "Ptr", FontFamily, "Float", FontSize, "Int", 1, "Int", 2, "Ptr*", Font)
    DllCall("gdiplus\GdipCreateSolidFill", "UInt", 0xFF000000, "Ptr*", Brush)
    DllCall("gdiplus\GdipCreateStringFormat", "Int", 0, "Int", 0, "Ptr*", Format)

    DllCall("gdiplus\GdipSetStringFormatAlign", "Ptr", Format, "Int", 1)
    DllCall("gdiplus\GdipSetStringFormatLineAlign", "Ptr", Format, "Int", 1)

    VarSetCapacity(RectF, 16, 0)
    NumPut(x, RectF, 0, "Float")
    NumPut(y, RectF, 4, "Float")
    NumPut(w, RectF, 8, "Float")
    NumPut(h, RectF, 12, "Float")

    DllCall("gdiplus\GdipDrawString", "Ptr", G, "WStr", Text, "Int", -1, "Ptr", Font, "Ptr", &RectF, "Ptr", Format, "Ptr", Brush)

    DllCall("gdiplus\GdipDeleteStringFormat", "Ptr", Format)
    DllCall("gdiplus\GdipDeleteBrush", "Ptr", Brush)
    DllCall("gdiplus\GdipDeleteFont", "Ptr", Font)
    DllCall("gdiplus\GdipDeleteFontFamily", "Ptr", FontFamily)
}


UpdateLayeredWindow(hwnd, hdc, x, y, w, h, Alpha := 255) {
    VarSetCapacity(pt, 8, 0)
    NumPut(x, pt, 0, "Int")
    NumPut(y, pt, 4, "Int")

    VarSetCapacity(size, 8, 0)
    NumPut(w, size, 0, "Int")
    NumPut(h, size, 4, "Int")

    VarSetCapacity(src, 8, 0)
    VarSetCapacity(blend, 4, 0)

    NumPut(0, blend, 0, "UChar")
    NumPut(0, blend, 1, "UChar")
    NumPut(Alpha, blend, 2, "UChar")
    NumPut(1, blend, 3, "UChar")

    DllCall("UpdateLayeredWindow", "Ptr", hwnd, "Ptr", 0, "Ptr", &pt, "Ptr", &size, "Ptr", hdc, "Ptr", &src, "UInt", 0, "Ptr", &blend, "UInt", 2)
}


CreateCompatibleDC(hdc := 0) {
    return DllCall("CreateCompatibleDC", "Ptr", hdc, "Ptr")
}


DeleteDC(hdc) {
    return DllCall("DeleteDC", "Ptr", hdc)
}


SelectObject(hdc, hgdiobj) {
    return DllCall("SelectObject", "Ptr", hdc, "Ptr", hgdiobj, "Ptr")
}


DeleteObject(hObject) {
    return DllCall("DeleteObject", "Ptr", hObject)
}


CreateDIBSection(w, h, ByRef ppvBits := 0) {
    hdc := DllCall("GetDC", "Ptr", 0, "Ptr")

    VarSetCapacity(bi, 40, 0)
    NumPut(40, bi, 0, "UInt")
    NumPut(w, bi, 4, "Int")
    NumPut(-h, bi, 8, "Int")
    NumPut(1, bi, 12, "UShort")
    NumPut(32, bi, 14, "UShort")
    NumPut(0, bi, 16, "UInt")

    hbm := DllCall("CreateDIBSection", "Ptr", hdc, "Ptr", &bi, "UInt", 0, "Ptr*", ppvBits, "Ptr", 0, "UInt", 0, "Ptr")
    DllCall("ReleaseDC", "Ptr", 0, "Ptr", hdc)

    return hbm
}


OnExit("Cleanup")


Cleanup(ExitReason, ExitCode) {
    global pBitmap, pToken, ImagePath
    if (pBitmap)
        Gdip_DisposeImage(pBitmap)
    if (pToken)
        Gdip_Shutdown(pToken)
    
    ; 프로그램 종료 시 생성했던 임시 이미지 파일 삭제
    if (FileExist(ImagePath))
        FileDelete, %ImagePath%
}
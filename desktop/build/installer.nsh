!include "nsDialogs.nsh"
!include "FileFunc.nsh"
!include "MUI2.nsh"

!macro customHeader
  BrandingText "Oni 감독 · 제작자 Oniabey"
!macroend

!ifndef BUILD_UNINSTALLER
Var LicenseDialog
Var LicenseEdit
Var LicenseText
Var LicenseSource
Var LicenseValidated

Function ValidateLicenseFile
  StrCpy $LicenseValidated "no"
  IfFileExists "$LicenseSource" 0 invalid_license
  ClearErrors
  ExecWait '"$PLUGINSDIR\license-verifier.exe" "$LicenseSource"' $0
  IfErrors invalid_license
  StrCmp $0 "0" 0 invalid_license
  StrCpy $LicenseValidated "yes"
  Return
  invalid_license:
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "인증키가 유효하지 않습니다.$\r$\nOniabey에게 발급받은 CD키 전체를 붙여넣어 주세요."
    ${EndIf}
FunctionEnd

Function LicensePageCreate
  !insertmacro MUI_HEADER_TEXT "CD키 인증" "Oni 감독 · 제작자 Oniabey"
  nsDialogs::Create 1018
  Pop $LicenseDialog
  ${If} $LicenseDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 34u "구매 시 전달받은 CD키 전체를 아래 칸에 붙여넣어 주세요.$\r$\n인터넷 연결 없이 인증합니다. 인증키는 이 설치에 저장됩니다."
  Pop $0
  ${NSD_CreateText} 0 42u 100% 24u "$LicenseText"
  Pop $LicenseEdit
  ${NSD_CreateLabel} 0 77u 100% 38u "인증키를 분실했거나 입력에 문제가 있으면 제작자 Oniabey에게 문의해 주세요."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function LicensePageLeave
  ${NSD_GetText} $LicenseEdit $LicenseText
  StrCpy $LicenseSource "$PLUGINSDIR\license.key"
  FileOpen $0 "$LicenseSource" w
  FileWrite $0 "$LicenseText"
  FileClose $0
  Call ValidateLicenseFile
  ${If} $LicenseValidated != "yes"
    Abort
  ${EndIf}
FunctionEnd

!macro customPageAfterChangeDir
  Page custom LicensePageCreate LicensePageLeave
!macroend

!macro customInit
  InitPluginsDir
  File /oname=$PLUGINSDIR\license-verifier.exe "${BUILD_RESOURCES_DIR}\license-verifier.exe"
  ${GetParameters} $0
  ${GetOptions} $0 "/LICENSEFILE=" $LicenseSource
  ${If} $LicenseSource == ""
    StrCpy $LicenseSource "$INSTDIR\license.key"
  ${EndIf}
  IfFileExists "$LicenseSource" 0 +4
    FileOpen $0 "$LicenseSource" r
    FileRead $0 $LicenseText
    FileClose $0
  ${If} ${Silent}
    Call ValidateLicenseFile
    ${If} $LicenseValidated != "yes"
      SetErrorLevel 2
      Quit
    ${EndIf}
    CopyFiles /SILENT "$LicenseSource" "$PLUGINSDIR\license.key"
    StrCpy $LicenseSource "$PLUGINSDIR\license.key"
  ${EndIf}
!macroend

!macro customInstall
  ; Recheck immediately before saving; silent installation must also be licensed.
  Call ValidateLicenseFile
  ${If} $LicenseValidated != "yes"
    SetErrorLevel 2
    Abort "CD키 인증에 실패했습니다."
  ${EndIf}
  ClearErrors
  CopyFiles /SILENT "$LicenseSource" "$INSTDIR\license.key"
  ${If} ${Errors}
    SetErrorLevel 2
    Abort "인증키 저장에 실패했습니다."
  ${EndIf}
!macroend
!endif

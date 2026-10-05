use serde::Serialize;

/// Errors crossing the IPC boundary. The UI switches on `code`; `message` is for logs only
/// and never contains research content (SQL errors name tables and columns, not values).
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("no project database is open")]
    NotOpen,
    #[error("wrong key for the project database")]
    WrongKey,
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid argument: {0}")]
    Invalid(String),
    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::NotOpen => "DB_NOT_OPEN",
            AppError::WrongKey => "WRONG_KEY",
            AppError::Db(_) => "DB_ERROR",
            AppError::Io(e) if e.kind() == std::io::ErrorKind::NotFound => "NOT_FOUND",
            AppError::Io(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                "PERMISSION_DENIED"
            }
            AppError::Io(_) => "IO_ERROR",
            AppError::Invalid(_) => "INVALID",
            AppError::Other(_) => "ERROR",
        }
    }

    pub fn not_found(what: &str) -> Self {
        AppError::Io(std::io::Error::new(std::io::ErrorKind::NotFound, what))
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("code", self.code())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_code_and_message() {
        let json = serde_json::to_value(AppError::WrongKey).unwrap();
        assert_eq!(json["code"], "WRONG_KEY");
        assert_eq!(AppError::not_found("x").code(), "NOT_FOUND");
        assert_eq!(AppError::Invalid("x".into()).code(), "INVALID");
        assert_eq!(AppError::NotOpen.code(), "DB_NOT_OPEN");
    }
}
